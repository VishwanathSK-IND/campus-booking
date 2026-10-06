import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { clock, createUserAgent, localDate, resetDatabase, setupDatabase, teardownDatabase } from './helpers.js';
import { bookingPayload, createResource } from './fixtures.js';
import { env } from '../config/env.js';
import { runAllJobs } from '../jobs/scheduler.js';
import { AuditLog } from '../models/AuditLog.js';
import { Booking } from '../models/Booking.js';
import { NoShowRecord } from '../models/NoShowRecord.js';
import { Notification } from '../models/Notification.js';
import { Restriction } from '../models/Restriction.js';
import { SlotLock } from '../models/SlotLock.js';
import { WaitlistEntry } from '../models/WaitlistEntry.js';
import { markNoShows, sendReminders } from '../services/lifecycleService.js';
import { expireWaitlist, promoteWaitlistForResource } from '../services/waitlistService.js';
import { addMinutes } from '../utils/time.js';

before(setupDatabase);
beforeEach(resetDatabase);
after(teardownDatabase);

const minutes = (date, n) => addMinutes(new Date(date), n);

describe('approval workflow', () => {
  async function setup() {
    const { agent: admin } = await createUserAgent('ADMIN');
    const faculty = await createUserAgent('FACULTY');
    const otherFaculty = await createUserAgent('FACULTY');
    const hall = await createResource(admin, {
      name: 'Seminar Hall A',
      category: 'HALL',
      approvers: [faculty.user._id],
      bookingRules: { approvalRequired: true, approvalExemptRoles: ['ADMIN'], maxDurationMinutes: 240, facultyPriority: true },
    });
    const student = await createUserAgent('STUDENT');
    return { admin, faculty, otherFaculty, hall, student };
  }

  it('creates a pending booking that holds the slot and notifies the assigned approver', async () => {
    const { faculty, hall, student } = await setup();
    const res = await student.agent.post('/api/bookings').send(await bookingPayload(hall._id));
    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, 'PENDING_APPROVAL');
    assert.equal(res.body.message, 'Booking request submitted for approval');
    assert.equal(await Notification.countDocuments({ user: faculty.user._id, type: 'APPROVAL_REQUESTED' }), 1);

    const queue = await faculty.agent.get('/api/bookings/pending-approvals');
    assert.equal(queue.body.data.length, 1);

    const other = await createUserAgent('STUDENT');
    const clash = await other.agent.post('/api/bookings').send(await bookingPayload(hall._id));
    assert.equal(clash.status, 409, 'pending bookings block the slot');
  });

  it('only assigned faculty or admins can approve; students and unassigned faculty cannot', async () => {
    const { faculty, otherFaculty, hall, student } = await setup();
    const booking = (await student.agent.post('/api/bookings').send(await bookingPayload(hall._id))).body.data;

    assert.equal((await student.agent.post(`/api/bookings/${booking._id}/approve`).send({})).status, 403);
    const unassigned = await otherFaculty.agent.post(`/api/bookings/${booking._id}/approve`).send({});
    assert.equal(unassigned.status, 403);
    assert.equal(unassigned.body.code, 'NOT_APPROVER');
    assert.equal((await otherFaculty.agent.get('/api/bookings/pending-approvals')).body.data.length, 0);

    const approve = await faculty.agent.post(`/api/bookings/${booking._id}/approve`).send({ note: 'Enjoy' });
    assert.equal(approve.status, 200);
    assert.equal(approve.body.data.status, 'CONFIRMED');
    assert.equal(approve.body.data.approvalStatus, 'APPROVED');
    assert.equal(await Notification.countDocuments({ user: student.user._id, type: 'BOOKING_APPROVED' }), 1);
    assert.equal(await AuditLog.countDocuments({ action: 'BOOKING_APPROVED', entityId: booking._id }), 1);

    const again = await faculty.agent.post(`/api/bookings/${booking._id}/approve`).send({});
    assert.equal(again.status, 409);
  });

  it('rejection requires a reason, persists it, releases the slot and notifies', async () => {
    const { admin, hall, student } = await setup();
    const booking = (await student.agent.post('/api/bookings').send(await bookingPayload(hall._id))).body.data;
    assert.equal((await admin.post(`/api/bookings/${booking._id}/reject`).send({})).status, 400);
    const res = await admin.post(`/api/bookings/${booking._id}/reject`).send({ reason: 'Hall reserved for convocation' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'REJECTED');
    assert.equal(res.body.data.rejectionReason, 'Hall reserved for convocation');
    assert.equal(await SlotLock.countDocuments({ ownerId: booking._id }), 0);
    const note = await Notification.findOne({ user: student.user._id, type: 'BOOKING_REJECTED' });
    assert.match(note.message, /convocation/);
  });

  it('Test D: approval after cancellation is rejected with 409', async () => {
    const { faculty, hall, student } = await setup();
    const booking = (await student.agent.post('/api/bookings').send(await bookingPayload(hall._id))).body.data;
    assert.equal((await student.agent.post(`/api/bookings/${booking._id}/cancel`).send({})).status, 200);
    const res = await faculty.agent.post(`/api/bookings/${booking._id}/approve`).send({});
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'INVALID_BOOKING_STATE');
  });

  it('racing approve and cancel: exactly one wins', async () => {
    const { faculty, hall, student } = await setup();
    const booking = (await student.agent.post('/api/bookings').send(await bookingPayload(hall._id))).body.data;
    const [approve, cancel] = await Promise.all([
      faculty.agent.post(`/api/bookings/${booking._id}/approve`).send({}),
      student.agent.post(`/api/bookings/${booking._id}/cancel`).send({}),
    ]);
    assert.equal([approve.status, cancel.status].filter((s) => s === 200).length, 1, `${approve.status}/${cancel.status}`);
    const final = await Booking.findById(booking._id);
    assert.ok(['CONFIRMED', 'CANCELLED'].includes(final.status));
    assert.equal(final.statusHistory.length, 2);
  });

  it('Case 6: approval is refused if the resource went into maintenance', async () => {
    const { admin, faculty, hall, student } = await setup();
    const booking = (await student.agent.post('/api/bookings').send(await bookingPayload(hall._id))).body.data;
    await admin.patch(`/api/resources/${hall._id}/status`).send({ status: 'MAINTENANCE' });
    const res = await faculty.agent.post(`/api/bookings/${booking._id}/approve`).send({});
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'RESOURCE_UNAVAILABLE');
  });

  it('approval exempt roles skip approval; faculty requests rank above students in the queue', async () => {
    const { admin, hall, student } = await setup();
    const adminBooking = await admin.post('/api/bookings').send(await bookingPayload(hall._id, { startTime: '08:00', endTime: '09:00' }));
    assert.equal(adminBooking.body.data.status, 'CONFIRMED');

    await student.agent.post('/api/bookings').send(await bookingPayload(hall._id, { startTime: '10:00', endTime: '11:00' }));
    const lateFaculty = await createUserAgent('FACULTY');
    await lateFaculty.agent.post('/api/bookings').send(await bookingPayload(hall._id, { startTime: '12:00', endTime: '13:00' }));
    const queue = await admin.get('/api/bookings/pending-approvals');
    assert.deepEqual(queue.body.data.map((b) => b.userSnapshot.role), ['FACULTY', 'STUDENT']);
  });

  it('unreviewed requests expire at start time and release the slot', async () => {
    const { hall, student } = await setup();
    const booking = (await student.agent.post('/api/bookings').send(await bookingPayload(hall._id))).body.data;
    clock.set(minutes(booking.startAt, 1));
    await runAllJobs();
    await runAllJobs();
    const final = await Booking.findById(booking._id);
    assert.equal(final.status, 'EXPIRED');
    assert.equal(await SlotLock.countDocuments({ ownerId: booking._id }), 0);
    assert.equal(await Notification.countDocuments({ type: 'BOOKING_EXPIRED' }), 1, 'idempotent notification');
  });
});

describe('cancellation', () => {
  it('enforces ownership, state and the cancellation deadline; admins can cancel with a reason', async () => {
    const { agent: admin } = await createUserAgent('ADMIN');
    const lab = await createResource(admin, { bookingRules: { cancellationDeadlineMinutes: 120 } });
    const owner = await createUserAgent('STUDENT');
    const stranger = await createUserAgent('STUDENT');
    const booking = (await owner.agent.post('/api/bookings').send(await bookingPayload(lab._id))).body.data;

    const foreign = await stranger.agent.post(`/api/bookings/${booking._id}/cancel`).send({});
    assert.equal(foreign.status, 403);

    clock.set(minutes(booking.startAt, -60));
    const late = await owner.agent.post(`/api/bookings/${booking._id}/cancel`).send({});
    assert.equal(late.status, 422);
    assert.equal(late.body.code, 'CANCELLATION_DEADLINE_PASSED');

    assert.equal((await admin.post(`/api/bookings/${booking._id}/cancel`).send({})).status, 400, 'reason required');
    const byAdmin = await admin.post(`/api/bookings/${booking._id}/cancel`).send({ reason: 'Power outage' });
    assert.equal(byAdmin.status, 200);
    assert.equal(byAdmin.body.data.cancellationReason, 'Power outage');
    assert.equal(byAdmin.body.data.cancelledBy, (await Booking.findById(booking._id)).cancelledBy.toString());
    assert.equal(await AuditLog.countDocuments({ action: 'BOOKING_CANCELLED' }), 1);

    const twice = await owner.agent.post(`/api/bookings/${booking._id}/cancel`).send({});
    assert.equal(twice.status, 409);
    assert.ok(await Booking.exists({ _id: booking._id }), 'cancelled bookings are kept as history');
  });
});

describe('QR check-in', () => {
  async function setup() {
    const { agent: admin } = await createUserAgent('ADMIN');
    const lab = await createResource(admin);
    const other = await createResource(admin, { name: 'Electronics Lab' });
    const student = await createUserAgent('STUDENT');
    const booking = (await student.agent.post('/api/bookings').send(await bookingPayload(lab._id))).body.data;
    const token = async (resourceId = lab._id) => (await admin.get(`/api/resources/${resourceId}/check-in-token`)).body.data.token;
    return { admin, lab, other, student, booking, token };
  }

  it('issues short-lived resource-bound tokens only to admins/assigned faculty', async () => {
    const { lab, student, token } = await setup();
    assert.equal((await student.agent.get(`/api/resources/${lab._id}/check-in-token`)).status, 403);
    const payload = jwt.decode(await token());
    assert.equal(payload.rid, lab._id);
    assert.equal(payload.exp - payload.iat, env.QR_TOKEN_TTL_SECONDS);
  });

  it('checks in inside the window and rejects duplicates', async () => {
    const { student, booking, token } = await setup();
    clock.set(minutes(booking.startAt, -5));
    const res = await student.agent.post(`/api/bookings/${booking._id}/check-in`).send({ token: await token() });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'CHECKED_IN');
    assert.ok(res.body.data.checkedInAt);

    const again = await student.agent.post(`/api/bookings/${booking._id}/check-in`).send({ token: await token() });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'ALREADY_CHECKED_IN');
  });

  it('rejects expired, forged and other-resource tokens, other users, and early/late attempts', async () => {
    const { other, student, booking, token } = await setup();
    clock.set(minutes(booking.startAt, 0));

    const expired = jwt.sign({ typ: 'checkin', rid: booking.resource, exp: Math.floor(Date.now() / 1000) - 10 }, env.QR_TOKEN_SECRET);
    assert.equal((await student.agent.post(`/api/bookings/${booking._id}/check-in`).send({ token: expired })).body.code, 'QR_TOKEN_EXPIRED');

    const forged = jwt.sign({ typ: 'checkin', rid: booking.resource }, 'not-the-secret');
    assert.equal((await student.agent.post(`/api/bookings/${booking._id}/check-in`).send({ token: forged })).body.code, 'QR_TOKEN_INVALID');

    const wrongVenue = await student.agent.post(`/api/bookings/${booking._id}/check-in`).send({ token: await token(other._id) });
    assert.equal(wrongVenue.status, 400);
    assert.equal(wrongVenue.body.code, 'QR_RESOURCE_MISMATCH');

    const intruder = await createUserAgent('STUDENT');
    assert.equal((await intruder.agent.post(`/api/bookings/${booking._id}/check-in`).send({ token: await token() })).status, 403);

    clock.set(minutes(booking.startAt, -30));
    assert.equal((await student.agent.post(`/api/bookings/${booking._id}/check-in`).send({ token: await token() })).body.code, 'CHECK_IN_TOO_EARLY');
    clock.set(minutes(booking.startAt, 16));
    assert.equal((await student.agent.post(`/api/bookings/${booking._id}/check-in`).send({ token: await token() })).body.code, 'CHECK_IN_CLOSED');
    assert.equal((await Booking.findById(booking._id)).status, 'CONFIRMED');
  });

  it('checked-in bookings complete after they end', async () => {
    const { student, booking, token } = await setup();
    clock.set(minutes(booking.startAt, 1));
    await student.agent.post(`/api/bookings/${booking._id}/check-in`).send({ token: await token() });
    clock.set(minutes(booking.endAt, 1));
    await runAllJobs();
    assert.equal((await Booking.findById(booking._id)).status, 'COMPLETED');
  });
});

describe('no-show handling', () => {
  it('marks missed check-ins as NO_SHOW once, escalates penalties and notifies', async () => {
    const { agent: admin } = await createUserAgent('ADMIN');
    const lab = await createResource(admin);
    const student = await createUserAgent('STUDENT');
    const first = (await student.agent.post('/api/bookings').send(await bookingPayload(lab._id, { startTime: '08:00', endTime: '09:00' }))).body.data;
    const second = (await student.agent.post('/api/bookings').send(await bookingPayload(lab._id, { startTime: '10:00', endTime: '11:00' }))).body.data;

    clock.set(minutes(first.startAt, 16));
    await Promise.all([markNoShows(clock.now()), markNoShows(clock.now())]); // two workers at once
    await runAllJobs();
    assert.equal((await Booking.findById(first._id)).status, 'NO_SHOW');
    assert.equal(await NoShowRecord.countDocuments({ booking: first._id }), 1);
    assert.equal((await NoShowRecord.findOne({ booking: first._id })).penaltyApplied, 'WARNING');
    assert.equal(await Restriction.countDocuments(), 0);
    assert.equal(await Notification.countDocuments({ user: student.user._id, type: 'NO_SHOW' }), 1);
    assert.equal(await SlotLock.countDocuments({ ownerId: first._id }), 0, 'remaining time released');

    clock.set(minutes(second.startAt, 16));
    await runAllJobs();
    const record = await NoShowRecord.findOne({ booking: second._id });
    assert.equal(record.penaltyApplied, 'RESTRICTION');
    assert.equal(record.countInWindow, 2);
    const restriction = await Restriction.findOne({ user: student.user._id });
    assert.equal(Math.round((restriction.endsAt - restriction.startsAt) / 86_400_000), 3);

    const blocked = await student.agent.post('/api/bookings').send(await bookingPayload(lab._id, { date: await localDate(3) }));
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'USER_RESTRICTED');

    const standing = await student.agent.get('/api/users/me/standing');
    assert.equal(standing.body.data.recentNoShows.length, 2);
    assert.ok(standing.body.data.activeRestriction);

    const lift = await admin.post(`/api/admin/restrictions/${restriction._id}/lift`).send({ reason: 'Medical emergency' });
    assert.equal(lift.status, 200);
    const allowed = await student.agent.post('/api/bookings').send(await bookingPayload(lab._id, { date: await localDate(3) }));
    assert.equal(allowed.status, 201);
  });

  it('reminders are sent once even if the job runs repeatedly', async () => {
    const { agent: admin } = await createUserAgent('ADMIN');
    const lab = await createResource(admin);
    const student = await createUserAgent('STUDENT');
    const booking = (await student.agent.post('/api/bookings').send(await bookingPayload(lab._id))).body.data;
    clock.set(minutes(booking.startAt, -20));
    await Promise.all([sendReminders(clock.now()), sendReminders(clock.now()), sendReminders(clock.now())]);
    assert.equal(await Notification.countDocuments({ type: 'BOOKING_REMINDER' }), 1);
    assert.equal(await Notification.countDocuments({ type: 'CHECK_IN_REMINDER' }), 1);
  });
});

describe('waitlist', () => {
  async function setup(rules = {}) {
    const { agent: admin } = await createUserAgent('ADMIN');
    const lab = await createResource(admin, { bookingRules: rules });
    const holder = await createUserAgent('STUDENT');
    const booking = (await holder.agent.post('/api/bookings').send(await bookingPayload(lab._id))).body.data;
    return { admin, lab, holder, booking };
  }

  it('join only when unavailable, prevent duplicates, deterministic positions', async () => {
    const { lab } = await setup();
    const s1 = await createUserAgent('STUDENT');
    const s2 = await createUserAgent('STUDENT');

    const free = await s1.agent.post('/api/waitlists').send(await bookingPayload(lab._id, { startTime: '14:00', endTime: '15:00' }));
    assert.equal(free.status, 409);
    assert.equal(free.body.code, 'SLOT_AVAILABLE');

    const first = await s1.agent.post('/api/waitlists').send(await bookingPayload(lab._id));
    assert.equal(first.status, 201);
    assert.equal(first.body.data.position, 1);
    const dup = await s1.agent.post('/api/waitlists').send(await bookingPayload(lab._id));
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'WAITLIST_DUPLICATE');
    const second = await s2.agent.post('/api/waitlists').send(await bookingPayload(lab._id));
    assert.equal(second.body.data.position, 2);
  });

  it('cancellation offers the slot to the first eligible user; acceptance creates a booking', async () => {
    const { lab, holder, booking } = await setup();
    const s1 = await createUserAgent('STUDENT');
    const s2 = await createUserAgent('STUDENT');
    const e1 = (await s1.agent.post('/api/waitlists').send(await bookingPayload(lab._id))).body.data;
    await s2.agent.post('/api/waitlists').send(await bookingPayload(lab._id));

    await holder.agent.post(`/api/bookings/${booking._id}/cancel`).send({});
    const offered = await WaitlistEntry.findById(e1._id);
    assert.equal(offered.status, 'OFFERED');
    assert.equal(await WaitlistEntry.countDocuments({ status: 'OFFERED' }), 1);
    assert.equal(await Notification.countDocuments({ user: s1.user._id, type: 'WAITLIST_OFFER' }), 1);

    // The held slot cannot be booked by someone else.
    const sniper = await createUserAgent('STUDENT');
    assert.equal((await sniper.agent.post('/api/bookings').send(await bookingPayload(lab._id))).status, 409);

    assert.equal((await s2.agent.post(`/api/waitlists/${e1._id}/accept`)).status, 403);
    const accept = await s1.agent.post(`/api/waitlists/${e1._id}/accept`);
    assert.equal(accept.status, 200);
    assert.equal(accept.body.data.status, 'CONFIRMED');
    assert.equal(accept.body.data.source, 'WAITLIST');
    assert.equal(await SlotLock.countDocuments({ ownerType: 'OFFER' }), 0);
    assert.equal(await SlotLock.countDocuments({ ownerId: accept.body.data._id }), 4);
    assert.equal((await s1.agent.post(`/api/waitlists/${e1._id}/accept`)).status, 409, 'cannot accept twice');
  });

  it('Test C: concurrent promotion workers produce a single offer', async () => {
    const { lab, holder, booking } = await setup();
    const users = await Promise.all([1, 2, 3].map(() => createUserAgent('STUDENT')));
    for (const u of users) await u.agent.post('/api/waitlists').send(await bookingPayload(lab._id));

    // Release the slot without triggering promotion, then race several workers.
    await Booking.updateOne({ _id: booking._id }, { status: 'CANCELLED' });
    await SlotLock.deleteMany({ ownerId: booking._id });
    const results = await Promise.all(Array.from({ length: 5 }, () => promoteWaitlistForResource(lab._id)));
    assert.equal(results.flat().length, 1);
    assert.equal(await WaitlistEntry.countDocuments({ status: 'OFFERED' }), 1);
    assert.equal(await SlotLock.countDocuments({ ownerType: 'OFFER' }), 4);

    // A retry does not promote again.
    assert.equal((await promoteWaitlistForResource(lab._id)).length, 0);
    void holder;
  });

  it('expired offers move to the next user; faculty priority orders the queue when enabled', async () => {
    const { lab, holder, booking } = await setup({ facultyPriority: true });
    const student = await createUserAgent('STUDENT');
    const faculty = await createUserAgent('FACULTY');
    const se = (await student.agent.post('/api/waitlists').send(await bookingPayload(lab._id))).body.data;
    const fe = (await faculty.agent.post('/api/waitlists').send(await bookingPayload(lab._id))).body.data;
    assert.equal(fe.position, 1, 'faculty ahead of an earlier student on a priority resource');
    assert.equal(se.priority, 1);

    await holder.agent.post(`/api/bookings/${booking._id}/cancel`).send({});
    assert.equal((await WaitlistEntry.findById(fe._id)).status, 'OFFERED');

    clock.set(addMinutes(new Date(), 16));
    await expireWaitlist(clock.now());
    await expireWaitlist(clock.now());
    assert.equal((await WaitlistEntry.findById(fe._id)).status, 'EXPIRED');
    assert.equal((await WaitlistEntry.findById(se._id)).status, 'OFFERED');
    assert.equal(await Notification.countDocuments({ type: 'WAITLIST_OFFER_EXPIRED' }), 1);

    const lateAccept = await faculty.agent.post(`/api/waitlists/${fe._id}/accept`);
    assert.equal(lateAccept.status, 409);
  });

  it('declining passes the offer on', async () => {
    const { lab, holder, booking } = await setup();
    const a = await createUserAgent('STUDENT');
    const b = await createUserAgent('STUDENT');
    const ea = (await a.agent.post('/api/waitlists').send(await bookingPayload(lab._id))).body.data;
    const eb = (await b.agent.post('/api/waitlists').send(await bookingPayload(lab._id))).body.data;
    await holder.agent.post(`/api/bookings/${booking._id}/cancel`).send({});
    assert.equal((await a.agent.post(`/api/waitlists/${ea._id}/decline`)).status, 200);
    assert.equal((await WaitlistEntry.findById(eb._id)).status, 'OFFERED');
  });
});

describe('analytics', () => {
  it('computes counts, utilisation, peaks and rates from real records', async () => {
    const { agent: admin } = await createUserAgent('ADMIN');
    const lab = await createResource(admin, { operatingHours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '08:00', close: '18:00' })) });
    const s = await createUserAgent('STUDENT');
    const date = await localDate(1);
    const b1 = (await s.agent.post('/api/bookings').send(await bookingPayload(lab._id, { date, startTime: '10:00', endTime: '12:00' }))).body.data;
    const b2 = (await s.agent.post('/api/bookings').send(await bookingPayload(lab._id, { date, startTime: '14:00', endTime: '15:00' }))).body.data;
    await s.agent.post(`/api/bookings/${b2._id}/cancel`).send({});
    void b1;

    const res = await admin.get(`/api/admin/analytics?from=${date}&to=${date}`);
    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.equal(data.totals.total, 2);
    assert.equal(data.totals.confirmed, 1);
    assert.equal(data.totals.cancelled, 1);
    assert.equal(data.rates.cancellationRate, 50);
    assert.equal(data.utilization.availableHours, 10);
    assert.equal(data.utilization.bookedHours, 2);
    assert.equal(data.utilization.utilizationPercent, 20);
    assert.deepEqual(data.peakHours.map((h) => h.hour), [10, 11]);
    assert.equal(data.mostUsedResources[0].name, 'Computer Lab 1');

    const student = await s.agent.get('/api/admin/analytics');
    assert.equal(student.status, 403);
    const faculty = await createUserAgent('FACULTY');
    const scoped = await faculty.agent.get(`/api/admin/analytics?from=${date}&to=${date}`);
    assert.equal(scoped.status, 200);
    assert.equal(scoped.body.data.totals.total, 0, 'faculty only see assigned resources');
  });
});
