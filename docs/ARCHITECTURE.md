# Architecture & Design — Campus Resource & Lab Booking System

This document records the design decisions behind the implementation: architecture,
data model, API, authorization, the booking state machine, and the strategies for
conflicts, waitlists, check-in, background jobs and real-time updates.

---

## 1. System architecture

```text
┌──────────────────────────────┐        REST (JSON, HttpOnly cookie)       ┌──────────────────────────────────────┐
│ React 19 + Vite (client/)    │ ───────────────────────────────────────▶ │ Express 5 API (server/)              │
│  • React Router              │                                           │  routes → middlewares → controllers  │
│  • TanStack Query (server    │ ◀─────── Socket.IO (cookie-auth) ──────── │        → services → Mongoose models  │
│    state, cache invalidation)│      "something changed" events           │  • node-cron scheduler (jobs/)       │
│  • Tailwind CSS              │                                           │  • Socket.IO server (sockets/)       │
└──────────────────────────────┘                                           └──────────────────┬───────────────────┘
                                                                                              │ Mongoose
                                                                                     ┌────────▼────────┐
                                                                                     │    MongoDB      │
                                                                                     └─────────────────┘
```

Request flow: `Route → Middleware (auth, role, zod validation) → Controller (HTTP only) → Service (business rules) → Model → MongoDB`.

The **backend is authoritative**: availability, overlap, limits, priority, approval
permissions, cancellation rules, check-in validity and no-show status are all decided
server-side. The UI only shows the actions the server says are valid
(`booking.actions`), and the server re-checks every one of them.

## 2. Database schema

| Collection | Purpose | Key fields |
|---|---|---|
| `users` | Accounts | name, email (unique, lower-case), password (bcrypt, `select:false`), role `STUDENT/FACULTY/ADMIN`, isActive |
| `resources` | Bookable things | name, category, location, capacity, status `ACTIVE/INACTIVE/MAINTENANCE`, facilities, `operatingHours[{day,open,close}]`, `bookingRules{…}`, `approvers[User]`, `blockedPeriods[]` |
| `bookings` | Durable booking record | code `CB-YYYYMMDD-XXXXXX`, resource, user, date/startTime/endTime (campus-local), startAt/endAt (UTC), purpose, status, approvalStatus, priority, checkInStatus, **resourceSnapshot / userSnapshot**, **policy snapshot** (checkInOpensAt, checkInClosesAt, cancellationDeadlineAt), reviewer/cancel/check-in fields, `statusHistory[]` |
| `slotlocks` | Concurrency guard | resource, slotStart, ownerType `BOOKING/BLOCK/OFFER`, ownerId — **unique (resource, slotStart)** |
| `waitlistentries` | Waitlist | resource, user, interval, purpose, priority, status `WAITING/OFFERED/ACCEPTED/DECLINED/EXPIRED/CANCELLED`, offerId, offerExpiresAt, booking |
| `notifications` | In-app notifications | user, type, title, message, booking/resource/waitlistEntry, isRead, dedupeKey (unique, partial) |
| `noshowrecords` | One per missed booking | user, booking (**unique**), resource, occurredAt, countInWindow, penaltyApplied, restriction |
| `restrictions` | Temporary booking bans | user, source `NO_SHOW/ADMIN`, reason, startsAt, endsAt, liftedAt/liftedBy |
| `auditlogs` | Append-only admin/system trail | actor (null = system), actorSnapshot, action, entityType, entityId, summary, details |
| `systempolicies` | Campus-wide policy (one doc) | maxActiveBookingsByRole, noShow{lookbackDays, tiers[]}, waitlist{offerMinutes, maxEntriesPerUser}, reminders{…} |
| `idempotencykeys` | Duplicate-request guard | user, scope, key (**unique**), status, resultId, TTL 24 h |

Every collection has a concrete job; there is no separate category collection (categories are a fixed enum).

### Indexes (driven by query patterns)

- `users.email` unique.
- `resources {status, category, name}`, `{location}`, `{approvers}`.
- `bookings {resource, startAt}` (availability/analytics), `{user, startAt}` (my bookings), `{user, status, endAt}` (active-limit counts),
  `{status, startAt}` (pending expiry), `{status, checkInClosesAt}` (no-show job), `{status, endAt}` (completion job), `{date}`, `code` unique.
- `slotlocks {resource, slotStart}` **unique**, `{ownerId}`.
- `waitlistentries` partial unique `{user, resource, startAt, endAt}` where status ∈ {WAITING, OFFERED}; `{resource, status, priority, createdAt, _id}` for ordering; `{status, offerExpiresAt}`.
- `notifications {user, isRead, createdAt}`, partial unique `{dedupeKey}`.
- `noshowrecords {booking}` unique, `{user, occurredAt}`.

## 3. Entity relationships

```text
User 1───* Booking *───1 Resource
  │           │ 1
  │           ├──* Notification
  │           ├──0..1 NoShowRecord ──0..1 Restriction
  │           └──* AuditLog (entityType=Booking)
  ├──* WaitlistEntry *───1 Resource
  ├──* Restriction
  └──* Notification
Resource 1───* SlotLock *───1 (Booking | blocked period | waitlist offer)
Resource *───* User (approvers)
```

Bookings are never deleted on cancellation; they keep their snapshots so history stays
readable even if the resource is renamed or deactivated.

## 4. API endpoint map

All responses: `{ success, message, data, meta? }` or `{ success:false, message, code, details? }`.

| Method & path | Who | Purpose |
|---|---|---|
| `POST /api/auth/register` | public | Create STUDENT account (role in body ignored) |
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` | public / public / auth | Session |
| `GET /api/resources` | auth | Search, category, location, minCapacity, approvalRequired, status (admin), `date+startTime+endTime` availability filter, sort, pagination |
| `GET /api/resources/locations` | auth | Distinct locations for filters |
| `GET /api/resources/:id` | auth | Details (+ `canManageCheckIn`) |
| `GET /api/resources/:id/availability?date=` | auth | Slot statuses + merged intervals |
| `POST /api/resources` · `PATCH /api/resources/:id` | admin | Create / edit (rules, hours, approvers) |
| `PATCH /api/resources/:id/status` | admin | ACTIVE / MAINTENANCE / INACTIVE (+ optional cancel of upcoming bookings) |
| `POST /api/resources/:id/blocks` · `DELETE …/blocks/:blockId` | admin | Blocked periods |
| `POST /api/bookings` (`Idempotency-Key` header) | auth | Create booking |
| `GET /api/bookings?scope=upcoming\|pending\|completed\|cancelled\|noshow\|all` | auth | Own bookings |
| `GET /api/bookings/pending-approvals` | faculty, admin | Review queue (scoped for faculty) |
| `GET /api/bookings/:id` | owner, admin, assigned approver | Details + allowed actions |
| `POST /api/bookings/:id/approve` · `/reject` | admin, assigned faculty | Review (reject needs reason) |
| `POST /api/bookings/:id/cancel` | owner, admin | Cancel |
| `POST /api/bookings/:id/check-in` | owner | One-click check-in (from start time until grace period ends) |
| `POST /api/waitlists` · `GET /api/waitlists` | auth | Join / list own |
| `POST /api/waitlists/:id/accept` · `/decline` · `DELETE /api/waitlists/:id` | entry owner | Respond / leave |
| `GET /api/notifications` · `GET …/unread-count` · `PATCH …/:id/read` · `POST …/read-all` | auth (own only) | Notifications |
| `GET /api/users/me/standing` · `PATCH /api/users/me` | auth | Restrictions/no-shows; edit name/department |
| `GET /api/users/approvers` | admin | Approver picker |
| `GET /api/admin/analytics?from&to&resource` | admin (campus), faculty (assigned resources) | Aggregated analytics |
| `GET /api/admin/dashboard` | admin | Summary |
| `GET/POST /api/admin/users`, `GET/PATCH /api/admin/users/:id` | admin | User management / provisioning |
| `POST /api/admin/users/:id/restrictions`, `POST /api/admin/restrictions/:id/lift` | admin | Restrictions |
| `GET /api/admin/bookings` | admin | Search/filter all bookings |
| `GET/PUT /api/admin/policy` | admin | Campus policy |
| `GET /api/admin/audit-logs` | admin | Audit trail |
| `POST /api/admin/jobs/run` | admin | Run scheduled jobs now (demo/ops) |

Resource administration lives on `/api/resources` (admin-guarded writes) rather than a
duplicate `/api/admin/resources` tree; admins see all statuses through the same list endpoint.

## 5. Authentication strategy

- Passwords hashed with bcrypt (cost 12).
- Login issues a JWT (`sub`, `role`, 7-day expiry) stored in an **HttpOnly** cookie `cb_token`
  (`Secure` + `SameSite=None` in production for a cross-site frontend; `Lax` in development).
  JavaScript never sees the token, so XSS cannot exfiltrate it.
- `requireAuth`: read cookie → verify JWT → load user from DB → reject if missing/inactive → `req.user`.
  Role always comes from the database, never from the token or client.
- Identical 401 message for unknown email / wrong password / disabled account, with a dummy bcrypt compare to keep timing similar.
- Self-registration always creates STUDENT. Faculty/admin accounts are provisioned by an admin
  (`POST /api/admin/users`) or with `npm run create-admin`.
- Socket.IO uses the same cookie for its handshake.
- Rate limiting on auth routes (30 / 15 min / IP) and the API (300 / min / IP).

## 6. Authorization matrix (as implemented)

| Action | Student | Faculty | Admin |
|---|---|---|---|
| Browse / search resources, view availability | ✔ | ✔ | ✔ (incl. inactive) |
| Book a resource | ✔ if role allowed by resource | ✔ if allowed | ✔ if allowed |
| Approval needed | per resource | per resource (often exempt) | per resource (exempt by default) |
| Cancel own booking | ✔ before deadline | ✔ before deadline | ✔ (deadline waived) |
| Cancel another user's booking | ✘ | ✘ | ✔ with reason (audited) |
| View a booking | own | own + assigned resources | all |
| Approve / reject | ✘ | assigned resources only, never own | ✔, never own |
| Check in | own booking only | own booking only | own booking only |
| Create / edit resources, rules, hours, blocks, status | ✘ | ✘ | ✔ |
| Analytics | ✘ | assigned resources only | campus-wide |
| Manage users, roles, restrictions, policy, audit log, run jobs | ✘ | ✘ | ✔ |

Enforced by `requireRole` on routes plus per-record checks in services (ownership, approver assignment).

## 7. Booking state machine

```text
                   approve                 check-in (button, in window)    booking ends (job)
PENDING_APPROVAL ──────────▶ CONFIRMED ─────────────────────────▶ CHECKED_IN ─────────────────▶ COMPLETED
   │   │   │                    │   │
   │   │   └─reject─▶ REJECTED  │   └─grace period passed, no check-in (job)─▶ NO_SHOW
   │   └─start time reached,    │
   │     unreviewed (job)─▶ EXPIRED
   └─cancel─▶ CANCELLED ◀───cancel┘
```

Defined in `server/utils/bookingStateMachine.js`. All changes go through
`transitionBooking(id, from, to)`, an atomic `findOneAndUpdate({_id, status: from})`.
If the booking is no longer in `from`, nothing changes and the caller gets 409. This makes
races (approve vs cancel), retries and duplicate job runs safe. Terminal states have no
outgoing transitions (`NO_SHOW → CONFIRMED` is impossible; admins can instead lift the
resulting restriction). Every transition is appended to `statusHistory`.

## 8. Conflict detection & concurrency strategy

**Design: materialised 15-minute slot locks with a unique index.**

1. A booking for `[startAt, endAt)` owns one `SlotLock` per 15-minute unit it covers
   (`10:00–11:30` → 6 locks). Admin blocked periods and waitlist offers own locks the same way.
2. `slotlocks` has a **unique index on `(resource, slotStart)`**.
3. Booking creation inserts all of its locks (`insertMany`, ordered). Two intervals overlap
   **iff** they share at least one 15-minute unit (`existing.start < requested.end && existing.end > requested.start`,
   with all boundaries on the 15-minute grid), so overlapping requests always collide on at least one lock row.
   MongoDB guarantees only one insert of that row succeeds — across concurrent requests, processes and servers.
   The loser gets a duplicate-key error → `409 BOOKING_CONFLICT`, and its partial locks are removed.
4. Lock granularity is fixed (15 min) and independent of a resource's slot length (15/30/60).
   Changing a resource from 30- to 60-minute slots therefore cannot produce disjoint lock sets.
5. Locks are released on CANCELLED / REJECTED / EXPIRED / NO_SHOW; old past locks are pruned by a job.

Why not just a unique index on `resource + date + startTime`? It only catches identical
start times; `10:00–12:00` vs `11:00–13:00` would slip through. The lock-per-unit design turns
arbitrary interval overlap into exact key equality the database can enforce.

**Transactions.** When MongoDB supports them (replica set/Atlas — detected at startup) the
booking, its locks, notifications and audit entries are written in one transaction. On a
standalone server, a compensation step deletes the booking and its locks if a later step fails,
and a cleanup job removes any orphaned locks after a crash. Conflict safety itself never
depends on transactions.

**Per-user limits under concurrency.** Limits (campus-wide by role and per resource) and
"no overlapping bookings of your own" are pre-checked for friendly errors, then **re-checked
after the booking is inserted** (counting it). Under transactions the unit of work also
touches the user document, so two concurrent bookings by the same user write-conflict and
serialise. Without transactions, both racing requests see each other and the over-limit one
rolls back (the safe direction: never over the limit).

**Idempotency.** The client sends an `Idempotency-Key` per intended booking (stable across
double clicks and retries). The server claims `(user, scope, key)` in a unique-indexed
collection. A repeat of a completed request returns the original booking (200); a repeat
while the first is running gets `409 REQUEST_IN_PROGRESS`; a failed request frees the key.

Verified by tests: 10 simultaneous requests for one slot → exactly one 201; partially
overlapping concurrent requests never produce overlapping bookings; a double-submit creates
one booking; concurrent bookings by one user never exceed the limit.

## 9. Waitlist strategy

- **Join** only when the requested interval is currently unavailable (otherwise `409 SLOT_AVAILABLE`),
  after the same rule validation as a booking. Duplicates are blocked by a partial unique index.
- **Ordering (deterministic):** `priority DESC, createdAt ASC, _id ASC`. Priority is non-zero
  only on resources with `facultyPriority`: faculty/admin = 2, student = 1.
- **Promotion** runs after any release of time (cancel, reject, block removal, declined/expired offer)
  and as a periodic recovery sweep. The highest-ranked WAITING entry whose *entire* interval is
  free gets an **offer**: the time is held with `OFFER` slot locks for `offerMinutes` (default 15).
- **Concurrency:** the offer's slot locks are the claim, so two workers cannot offer the same
  time; `WAITING → OFFERED` is compare-and-set, so an entry cannot be offered twice. Tested with 5
  concurrent promoters → exactly one offer, and a retry creates none.
- **Accept** atomically flips `OFFERED → ACCEPTED` and transfers the held locks to a new booking
  (subject to the normal approval rule). **Decline/expiry** releases the hold and promotes the next entry.
- Stale WAITING entries expire when their start time passes.

## 10. Check-in strategy

- No QR code or link: the booking owner checks in with one click on the booking.
- The check-in window opens **exactly at the booked start time** (`checkInOpensAt = startAt`) and
  closes `checkInGraceMinutes` later (default 15, configurable per resource, capped at `endAt`);
  both are snapshotted on the booking.
- The server exposes `actions.checkIn` while the owner's CONFIRMED booking is before
  `checkInClosesAt`. The UI shows the button disabled ("Check in at HH:MM") until `startAt`, then
  enables it via a timer (no refresh needed) and hides it once the window closes.
- `POST /api/bookings/:id/check-in` verifies: booking exists → belongs to the caller → not already
  checked in (409) → status CONFIRMED → now ≥ `startAt` (`422 CHECK_IN_TOO_EARLY`) and
  ≤ `checkInClosesAt` (`422 CHECK_IN_CLOSED`) → atomic `CONFIRMED → CHECKED_IN`.
  The client clock is never trusted; the server re-checks every rule.

## 11. Background-job strategy

`node-cron` runs `runAllJobs()` every minute (`JOBS_CRON`), with an in-process re-entrancy guard:

| Job | What it does | Idempotency |
|---|---|---|
| expirePendingApprovals | unreviewed requests at start time → EXPIRED, release slot, notify | CAS transition + notification dedupeKey |
| markNoShows | CONFIRMED past `checkInClosesAt` → NO_SHOW, release time, NoShowRecord, escalate penalty, notify, audit | CAS transition + unique NoShowRecord.booking |
| completeBookings | CHECKED_IN past `endAt` → COMPLETED | CAS transition |
| expireWaitlist | expire unanswered offers (→ next user) and stale entries | CAS on offerId |
| promoteWaitlists | recovery sweep for missed promotions | lock-based claim |
| sendReminders | reminder (default 24 h) and check-in reminder (30 min) | CAS on `reminderSentAt` + dedupeKey |
| cleanupOrphanLocks | remove locks without a live owner; prune past locks | delete-only |

No-show penalties come from `SystemPolicy.noShow.tiers` (default: 1st = warning,
2nd = 3-day restriction, 3rd+ = 14-day restriction, within a 90-day window). Restrictions are
always temporary and can be lifted by an admin (audited). Admins can trigger all jobs
immediately with `POST /api/admin/jobs/run`. Redis/BullMQ is not used: idempotent jobs over
MongoDB are enough at campus scale.

## 12. Socket.IO event map

Rooms: `user:<id>` (private), `resource:<id>` (joined via `resource:watch` while viewing availability), `staff` (faculty + admins).

| Event | Room | Emitted after |
|---|---|---|
| `availability.updated {resourceId, date}` | resource | any booking/lock change for that resource |
| `booking.created / approved / rejected / cancelled / checkedIn / completed / noShow / expired` | user | the corresponding committed transition |
| `booking.updated` | staff | any booking change (refresh queues/admin views) |
| `approval.requested` | staff | new pending booking |
| `waitlist.promoted` | user | offer created |
| `notification.created` | user | notification persisted |
| `resource.statusChanged` | all | admin status change |
| `resource.updated` | resource | admin edit |

Events are emitted only after successful writes (`ctx.afterCommit`). The client treats them
as cache-invalidation hints (TanStack Query refetches from REST). On every reconnect the client
invalidates all queries, so missed events cannot leave the UI stale. If sockets are down,
REST keeps working and the unread count polls every 60 s.

## 13. Frontend route map

| Route | Access |
|---|---|
| `/`, `/login`, `/register` | public (login/register redirect if signed in) |
| `/dashboard`, `/resources`, `/resources/:id`, `/resources/:id/book`, `/my-bookings`, `/bookings/:id`, `/notifications`, `/profile` | signed in |
| `/approvals`, `/analytics` | faculty + admin |
| `/admin`, `/admin/resources`, `/admin/resources/new`, `/admin/resources/:id/edit`, `/admin/bookings`, `/admin/users`, `/admin/analytics`, `/admin/policy`, `/admin/audit` | admin |

Route guards only shape the UI; the API enforces every permission independently.

## 14. Testing plan

Automated (`cd server && npm test`, Node test runner + supertest against a real MongoDB test database):

- **auth.test.js** — registration, normalisation, hashing, no password leakage, self-admin prevented, duplicates, login/me/logout, uniform 401, invalid/tampered/deactivated tokens, 400 malformed JSON, 413 oversized body.
- **resources.test.js** — admin-only CRUD + audit, validation, search/filter/sort/pagination, availability filter, slot statuses (booked/blocked/maintenance), block conflicts, maintenance with cancellation.
- **bookings.test.js** — snapshots & codes, every validation rule, maintenance/inactive/role checks, arbitrary overlap, slot-size change, limits, own-overlap, restriction 403, **concurrency (Test A)**, **double-click idempotency (Test B)**, concurrent per-user limit.
- **workflows.test.js** — approval (assigned approvers, unauthorised reviewers, rejection reason, **approval after cancellation → 409 (Test D)**, approve/cancel race, resource-maintenance revalidation, priority ordering, expiry), cancellation deadline/ownership/admin reason, check-in (opens exactly at start, no code needed, duplicate, other user, early, late, completion), no-show (concurrent jobs, escalation, restriction, lift), reminders once, waitlist (join rules, duplicates, positions, offer → accept, **concurrent promotion (Test C)**, expiry → next user, priority, decline), analytics numbers.
- **security.test.js** — unauthenticated access, expired/forged JWTs, students vs admin APIs, other users' bookings/notifications, faculty vs admin config, malformed ids/query params, operator injection, admin provisioning and self-lockout.

Manual: `npm run seed`, then the five demo workflows in the README, plus `npm run demo -- check-in | no-show`.
