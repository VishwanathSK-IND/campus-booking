# Campus Resource & Lab Booking System

A MERN web application that gives students, faculty and administrators one reliable place to
discover, reserve, approve, check in to and analyse shared campus resources — labs, seminar
halls, sports courts, rooms and equipment.

## Live links

| | Link |
|---|---|
| **Live application** | https://campus-booking-beta.vercel.app |
| Backend API (health check) | https://campus-booking-api-quij.onrender.com/api/health |
| Source code | https://github.com/VishwanathSK-IND/campus-booking |
| Architecture document | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Postman collection | [server/postman/campus-booking.postman_collection.json](server/postman/campus-booking.postman_collection.json) |

**Demo logins** (password for all: `Campus@123`): `admin@campus.edu` (admin), `mehta@campus.edu` (faculty / approver),
`asha@campus.edu` (student). Students can also register their own account. More accounts: [Demo accounts](#demo-accounts-password-campus123).

> The backend runs on Render's free tier and sleeps after ~15 minutes without traffic, so the
> first request after a pause can take up to a minute. Later requests are fast.

> Detailed design (schema, API map, authorization matrix, state machine, concurrency, jobs,
> sockets, testing plan) is in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Problem statement

Colleges typically manage shared resources through WhatsApp groups, paper registers,
spreadsheets and verbal requests. The result: double bookings, unclear availability, slow and
opaque approvals, no-show reservations that waste scarce rooms, no fair way to handle
cancellations, and no data on how resources are actually used.

## Target users

- **Students** — find and book resources, join waitlists, check in, track their bookings.
- **Faculty** — book (with priority where a resource's policy allows it), review requests for resources assigned to them, view usage of those resources.
- **Administrators** — manage resources, rules, users and policies; oversee all bookings; analyse utilisation.

## Solution

The core of the product is a complete booking lifecycle rather than CRUD records:

```text
Search → Filter → View resource → Check availability → Select time → Validate rules
→ Conflict-safe reservation → Approval (if required) → Confirmation → Reminder
→ Check-in → Usage → Completion / No-show → Analytics
```

## Key features (all implemented)

- **Authentication**: register/login/logout, JWT in an HttpOnly cookie, bcrypt, protected routes. Students self-register; faculty/admins are provisioned by an admin.
- **Role-based authorization** enforced on the server (student / faculty / admin, plus per-resource approver assignment).
- **Resource management**: categories, locations, capacity, facilities, per-day operating hours, data-driven booking rules (slot length, min/max duration, advance window, per-user limit, allowed roles, approval & exempt roles, faculty priority, cancellation deadline, check-in window), approvers, blocked periods, ACTIVE / MAINTENANCE / INACTIVE status (with explicit handling of existing bookings).
- **Discovery**: search, category/location/capacity filters, "free at this time" filter, sorting, pagination — one dynamic query.
- **Live availability** per slot (available, booked, pending, held for waitlist, blocked, maintenance, past), shown with text and symbols, not just colour.
- **Conflict-safe booking**: full rule validation, arbitrary-interval overlap prevention that holds under concurrency, per-user limits, idempotent submission, human-readable booking codes, historical snapshots.
- **Approval workflow** with revalidation, rejection reasons, priority-ordered queue and automatic expiry.
- **Cancellation** with deadlines, admin cancellation with reasons, history preserved.
- **Waitlist** with deterministic ordering, time-limited offers, accept/decline, concurrency-safe promotion.
- **One-click check-in**: the booking's **Check in** button unlocks exactly at the booked start time and stays available until the grace period ends.
- **No-show handling** by a background job, with escalating, configurable, temporary restrictions.
- **Notifications** (persistent, read/unread, real-time push) for every booking event and reminders.
- **Real-time updates** with Socket.IO, with resync on reconnect.
- **Analytics** via MongoDB aggregation: booking statistics, utilisation, peak hours/days, most-used resources, cancellation and no-show rates.
- **Audit log** of administrative and automated actions; **campus policy** editor.

## Core workflows

1. **Resource booking** — Student logs in → Resources → searches "computer" → filters category *Laboratory* → opens *Computer Lab 1* → picks a date → clicks a free slot (and a later one to extend) → enters a purpose → **Book now** → server validates → confirmation page with booking code.
2. **Approval** — Student books *Seminar Hall A* → status *Pending approval* (slot held) → Dr. Mehta (assigned approver) gets a notification → **Approvals** → Approve (student notified, booking *Confirmed*) or Reject with a reason.
3. **Check-in & no-show** — Student opens the booking: before the start time the button shows *Check in at HH:MM* (disabled); at the start time it unlocks → **Check in** → *Checked in*. A confirmed booking without check-in becomes *No-show* when the grace period passes (scheduler, every minute), creating a no-show record, warning/restriction and notification.
4. **Waitlist** — A slot is taken → student selects it on the booking page → **Join waitlist** (position shown) → the holder cancels → the next eligible person receives a held, 15-minute offer → **Accept** → booking confirmed.
5. **Admin analytics** — Admin logs in → dashboard (resources, today's bookings, pending approvals, utilisation, no-shows, peak resources) → **Analytics**: statistics, utilisation by resource, peak hours/days, most-used resources, cancellation and no-show rates for any date range.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, React Router, TanStack Query, Axios, Tailwind CSS 4, socket.io-client |
| Backend | Node.js (≥ 20), Express 5, Mongoose 8, zod, jsonwebtoken, bcryptjs, cookie-parser, helmet, cors, express-rate-limit, node-cron, luxon, Socket.IO |
| Database | MongoDB (standalone or Atlas replica set) |
| Tests | Node test runner, supertest |

## Architecture

```text
React (Vite) ──REST──▶ Express routes → middlewares → controllers → services → Mongoose → MongoDB
React ◀──Socket.IO (cookie auth)──▶ Node  (events = "refetch" hints; REST stays the source of truth)
node-cron scheduler → lifecycle services (no-shows, completion, expiry, reminders, waitlist)
```

```text
server/
  app.js, server.js
  config/       env + database (detects transaction support)
  routes/       URL → middleware → controller
  middlewares/  auth (cookie JWT), role guard, zod validation, rate limits, error handler
  controllers/  thin HTTP adapters
  services/     business logic (booking, rules, slot locks, waitlist, lifecycle, analytics, …)
  models/       Mongoose schemas
  validators/   zod request schemas
  jobs/         scheduler
  sockets/      Socket.IO server + emitter facade
  utils/        state machine, time (campus timezone), transactions, errors, clock
  scripts/      seed, demo scenarios, create-admin
  tests/        API test suites
client/src/
  api/          axios client + endpoint functions
  hooks/        auth, socket, toast
  routes/       route guards
  layouts/      app + auth layouts
  components/   UI kit, availability grid, booking actions, charts
  pages/        user pages and pages/admin/*
  utils/        formatting, status metadata
```

## Database schema

Collections: `users`, `resources`, `bookings`, `slotlocks`, `waitlistentries`, `notifications`,
`noshowrecords`, `restrictions`, `auditlogs`, `systempolicies`, `idempotencykeys`.
Bookings reference users and resources and store **snapshots** (resource name/location/category,
user name/email/role, and the check-in/cancellation rules in force) so history stays meaningful
when resources change. Full field list, relationships and indexes: [docs/ARCHITECTURE.md §2–3](docs/ARCHITECTURE.md#2-database-schema).

## Booking conflict strategy

Every booking claims one **slot-lock document per 15-minute unit** it covers, and the
`slotlocks` collection has a **unique index on (resource, slotStart)**. Any two overlapping
intervals share at least one unit, so only one of two concurrent overlapping requests can
insert that row; the other fails with a duplicate-key error and receives
`409 BOOKING_CONFLICT`. This enforces arbitrary-range overlap
(`existing.start < requested.end && existing.end > requested.start`) at the database level,
across processes and without relying on transactions. A plain unique index on
`resource + date + startTime` would *not* do this: it misses `10:00–12:00` vs `11:00–13:00`.

- Lock granularity is fixed at 15 minutes regardless of a resource's slot length, so rule changes cannot create gaps.
- Admin blocked periods and waitlist offers use the same locks, so they participate in conflict checks too.
- Locks are released on cancel/reject/expiry/no-show; a job removes orphans and prunes past locks.
- With a replica set (Atlas), booking + locks + notifications + audit commit in one transaction; on a standalone server, failures are compensated.
- Per-user limits are re-checked after insert (and serialised by a user-document write under transactions), so concurrent requests cannot exceed them.
- Double submits are neutralised with an `Idempotency-Key` header.

Details and test evidence: [docs/ARCHITECTURE.md §8](docs/ARCHITECTURE.md#8-conflict-detection--concurrency-strategy).

## Authentication

`POST /api/auth/login` verifies the bcrypt hash and sets a signed JWT in the **HttpOnly**
`cb_token` cookie (Secure + SameSite=None in production, Lax in development). Every protected
request goes through cookie → verify JWT → load the user from MongoDB (role comes from the DB) →
`req.user`. Logout clears the cookie. Tokens are never stored in localStorage. Socket.IO
authenticates with the same cookie.

## Local setup

Prerequisites: **Node.js 20+** (22.22+ recommended) and **MongoDB** running locally (or an Atlas URI).

```bash
# 1. API
cd server
cp .env.example .env          # adjust MONGO_URI / secrets if needed
npm install
npm run seed                  # wipes & fills the database with demo data (through the real services)
npm run dev                   # http://localhost:5000

# 2. Web app (second terminal)
cd client
cp .env.example .env          # values can stay empty for local development
npm install
npm run dev                   # http://localhost:5173  (proxies /api and /socket.io to :5000)
```

### Demo accounts (password `Campus@123`)

| Role | Email | Notes |
|---|---|---|
| Admin | admin@campus.edu | |
| Faculty | mehta@campus.edu | approver for Seminar Halls A/B and Project Room 101 |
| Faculty | iyer@campus.edu | approver for Electronics Lab |
| Student | asha@campus.edu | main demo student (upcoming booking, pending hall request, one past no-show warning) |
| Student | ravi@campus.edu | holds Computer Lab 1 tomorrow 10:00–12:00 (use it for the waitlist demo) |

The seed replays three weeks of activity by moving the application clock back and calling the
real booking, approval, cancellation, check-in and job code, so analytics, no-shows and
restrictions are real outputs of the business logic.

### Live demo helpers

```bash
cd server
npm run demo -- check-in [email]   # booking in Project Room 101 that has just started
                                   # (or starts at the next quarter hour)
npm run demo -- no-show  [email]   # booking that started ~20 min ago, never checked in;
                                   # the scheduler marks it NO_SHOW within a minute
                                   # (or Admin ▸ "Run scheduled jobs now")
```

For check-in: log in as the student and open the booking. The **Check in** button is disabled until the
start time and unlocks on its own when it arrives (no page refresh needed).

### Create an admin on a fresh database

```bash
ADMIN_PASSWORD='Choose-A-Strong-Pass1' npm run create-admin -- you@college.edu "Your Name"
```

## Environment variables

`server/.env.example`

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | development | `production` enables secure cookies and requires secrets |
| `PORT` | 5000 | API port |
| `MONGO_URI` | mongodb://127.0.0.1:27017/campus_booking | Database |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | dev fallback, 7d | Session tokens (**required in production**) |
| `CLIENT_URL` | http://localhost:5173 | Allowed origin(s), comma-separated |
| `APP_TIMEZONE` | Asia/Kolkata | Campus timezone for hours, bookings and analytics |
| `COOKIE_SECURE`, `COOKIE_SAMESITE` | prod: true / none | Cookie flags |
| `TRUST_PROXY` | prod: true | Behind Render/Railway/Nginx |
| `JOBS_ENABLED`, `JOBS_CRON` | true, `* * * * *` | Scheduler |
| `RATE_LIMIT_ENABLED` | true | Rate limiting |

`client/.env.example`: `VITE_API_URL`, `VITE_SOCKET_URL` (empty in dev; API origin in production), `VITE_APP_TIMEZONE`.

## API documentation

Major endpoints (full map with access rules in [docs/ARCHITECTURE.md §4](docs/ARCHITECTURE.md#4-api-endpoint-map)):

```http
POST   /api/auth/register | /login | /logout        GET /api/auth/me
GET    /api/resources?search=&category=&location=&date=&startTime=&endTime=&sort=&page=
GET    /api/resources/:id            GET /api/resources/:id/availability?date=YYYY-MM-DD
POST   /api/resources  PATCH /api/resources/:id  PATCH /api/resources/:id/status   (admin)
POST   /api/bookings   (header Idempotency-Key)  GET /api/bookings?scope=upcoming
GET    /api/bookings/:id
POST   /api/bookings/:id/approve | /reject | /cancel | /check-in
POST   /api/waitlists  GET /api/waitlists  POST /api/waitlists/:id/accept | /decline
GET    /api/notifications  PATCH /api/notifications/:id/read  POST /api/notifications/read-all
GET    /api/admin/dashboard | /analytics | /users | /bookings | /policy | /audit-logs
```

**Postman:** import [`server/postman/campus-booking.postman_collection.json`](server/postman/campus-booking.postman_collection.json)
(every endpoint, sample bodies, demo logins). Auth is a cookie, so after a *Login* request Postman stays signed in;
requests that create data save their IDs (`resourceId`, `bookingId`, …) for the next requests.

Example error:

```json
{ "success": false, "message": "The selected time overlaps with an existing booking or blocked period", "code": "BOOKING_CONFLICT" }
```

Status codes: 400 validation, 401 unauthenticated, 403 forbidden/restricted, 404 not found,
409 conflict / invalid state transition, 413 payload too large, 422 business-rule violation
(limits, deadlines, check-in window), 429 rate limited, 500 generic (no stack traces).

## Testing

```bash
cd server
npm test        # 54 API tests against mongodb://127.0.0.1:27017/campus_booking_test
                # (override with MONGO_URI_TEST)
```

Covers authentication, authorization, validation, overlap, **concurrent booking**,
**double-submit idempotency**, **concurrent waitlist promotion**, **approval after cancellation**,
approval/cancel races, check-in rules, no-show jobs and penalties, reminders, waitlist
offers/expiry and analytics. See [docs/ARCHITECTURE.md §14](docs/ARCHITECTURE.md#14-testing-plan).

## Deployment

The application is deployed and publicly accessible:

| Part | Service | URL |
|---|---|---|
| Frontend (React / Vite) | Vercel | https://campus-booking-beta.vercel.app |
| Backend (Express + Socket.IO + scheduler) | Render (web service, Singapore) | https://campus-booking-api-quij.onrender.com |
| Database | MongoDB Atlas (replica set, Singapore) | — (private) |
| Source code | GitHub | https://github.com/VishwanathSK-IND/campus-booking |

```text
Browser ──▶ Vercel (static React build)
   │
   ├── REST  /api/*      ──▶ Render: Express ──▶ MongoDB Atlas
   └── Socket.IO (cookie) ─▶ Render: Socket.IO + node-cron jobs
```

### How it is configured

**Render (backend)**: root directory `server`, build `npm install`, start `npm start`,
health check path `/api/health`, auto-deploy on commit.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` (Secure + SameSite=None cookies, trust proxy, required secrets) |
| `MONGO_URI` | Atlas connection string (kept in Render, never committed) |
| `JWT_SECRET` | long random string (kept in Render, never committed) |
| `CLIENT_URL` | `https://campus-booking-beta.vercel.app` |
| `APP_TIMEZONE` | `Asia/Kolkata` |

**Vercel (frontend)**: root directory `client`, framework Vite, build `npm run build`, output `dist`.
[`client/vercel.json`](client/vercel.json) rewrites every path to `index.html` so routes such as
`/dashboard` survive a page refresh.

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://campus-booking-api-quij.onrender.com` |
| `VITE_SOCKET_URL` | `https://campus-booking-api-quij.onrender.com` |
| `VITE_APP_TIMEZONE` | `Asia/Kolkata` |

Vite variables are baked in at build time, so changing them requires a redeploy on Vercel.

**MongoDB Atlas**: one database user, network access `0.0.0.0/0` (Render has no fixed outbound IP;
access still requires the user's credentials). The demo data was loaded by running `npm run seed`
locally with `MONGO_URI` pointing at Atlas (the seed drops the database first, so the user needs
permission to drop databases while seeding).

### Updating the live site

```bash
git add .
git commit -m "Describe the change"
git push            # Render and Vercel redeploy automatically
```

### Notes

- The API must run as a long-lived process (not serverless) because of Socket.IO and the scheduler.
- On Render's free tier the service sleeps when idle; scheduled jobs (no-shows, reminders, waitlist
  offers) pause while it sleeps and catch up when it wakes.
- If `npm run seed` fails locally with `querySrv ECONNREFUSED`, the local DNS resolver is refusing
  the SRV lookup for `mongodb+srv://` URIs; use a different DNS server (e.g. 8.8.8.8) for that run.
