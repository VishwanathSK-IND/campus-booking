import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clock, createUserAgent, localDate, resetDatabase, setupDatabase, teardownDatabase } from './helpers.js';
import { bookingPayload, createResource } from './fixtures.js';
import { Booking } from '../models/Booking.js';
import { Resource } from '../models/Resource.js';
import { SlotLock } from '../models/SlotLock.js';
import { SystemPolicy } from '../models/SystemPolicy.js';
import { Restriction } from '../models/Restriction.js';

before(setupDatabase);
beforeEach(resetDatabase);
after(teardownDatabase);

async function setup(overrides) {
  const { agent: admin } = await createUserAgent('ADMIN');
  const resource = await createResource(admin, overrides);
  const a = await createUserAgent('STUDENT');
  const b = await createUserAgent('STUDENT');
  return { admin, resource, a, b };
}

describe('booking creation and validation', () => {
  it('creates a confirmed booking with snapshots, policy snapshot and a human-readable code', async () => {
    const { resource, a } = await setup();
    const res = await a.agent.post('/api/bookings').send(await bookingPayload(resource._id));
    assert.equal(res.status, 201);
    assert.equal(res.body.message, 'Booking confirmed successfully');
    const booking = res.body.data;
    assert.equal(booking.status, 'CONFIRMED');
    assert.match(booking.code, /^CB-\d{8}-[A-Z2-9]{6}$/);
    assert.equal(booking.resourceSnapshot.name, 'Computer Lab 1');
    assert.equal(booking.userSnapshot.email, a.user.email);
    assert.equal(new Date(booking.checkInClosesAt) - new Date(booking.startAt), 15 * 60 * 1000);
    assert.equal(await SlotLock.countDocuments({ ownerId: booking._id }), 4, 'one lock per 15 minutes');

    // Renaming the resource does not change history.
    await Resource.updateOne({ _id: resource._id }, { name: 'Advanced Computing Lab' });
    const detail = await a.agent.get(`/api/bookings/${booking._id}`);
    assert.equal(detail.body.data.resourceSnapshot.name, 'Computer Lab 1');
    assert.equal(detail.body.data.resource.name, 'Advanced Computing Lab');
  });

  it('rejects invalid times, past times, durations, operating hours and booking windows', async () => {
    const { resource, a } = await setup({
      operatingHours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '08:00', close: '18:00' })),
    });
    const cases = [
      [{ startTime: '11:00', endTime: '10:00' }, 400, 'INVALID_TIME'],
      [{ startTime: '10:10', endTime: '11:00' }, 400, 'INVALID_TIME'],
      [{ startTime: '07:00', endTime: '08:30' }, 400, 'OUTSIDE_OPERATING_HOURS'],
      [{ startTime: '17:30', endTime: '18:30' }, 400, 'OUTSIDE_OPERATING_HOURS'],
      [{ startTime: '09:00', endTime: '12:00' }, 400, 'DURATION_EXCEEDED'],
      [{ date: await localDate(-1) }, 400, 'BOOKING_IN_PAST'],
      [{ date: await localDate(30) }, 400, 'OUTSIDE_BOOKING_WINDOW'],
      [{ date: '2026-02-30' }, 400, 'VALIDATION_ERROR'],
      [{ startTime: '25:00' }, 400, 'VALIDATION_ERROR'],
      [{ purpose: '' }, 400, 'VALIDATION_ERROR'],
    ];
    for (const [overrides, status, code] of cases) {
      const res = await a.agent.post('/api/bookings').send(await bookingPayload(resource._id, overrides));
      assert.equal(res.status, status, `${JSON.stringify(overrides)} → ${JSON.stringify(res.body)}`);
      assert.equal(res.body.code, code, JSON.stringify(overrides));
    }
    assert.equal(await Booking.countDocuments(), 0);
  });

  it('blocks bookings on maintenance/inactive resources and disallowed roles', async () => {
    const { admin, resource, a } = await setup({ bookingRules: { allowedRoles: ['FACULTY', 'ADMIN'] } });
    const roleRes = await a.agent.post('/api/bookings').send(await bookingPayload(resource._id));
    assert.equal(roleRes.status, 403);
    assert.equal(roleRes.body.code, 'ROLE_NOT_ALLOWED');

    const faculty = await createUserAgent('FACULTY');
    await admin.patch(`/api/resources/${resource._id}/status`).send({ status: 'MAINTENANCE' });
    const maint = await faculty.agent.post('/api/bookings').send(await bookingPayload(resource._id));
    assert.equal(maint.status, 409);
    assert.equal(maint.body.code, 'RESOURCE_MAINTENANCE');

    await admin.patch(`/api/resources/${resource._id}/status`).send({ status: 'INACTIVE' });
    const inactive = await faculty.agent.post('/api/bookings').send(await bookingPayload(resource._id));
    assert.equal(inactive.body.code, 'RESOURCE_INACTIVE');
  });

  it('detects arbitrary interval overlap, not just identical start times', async () => {
    const { resource, a, b } = await setup();
    assert.equal((await a.agent.post('/api/bookings').send(await bookingPayload(resource._id, { startTime: '10:00', endTime: '12:00' }))).status, 201);

    for (const [startTime, endTime] of [['11:00', '13:00'], ['09:00', '10:30'], ['10:30', '11:00'], ['09:30', '11:30']]) {
      const res = await b.agent.post('/api/bookings').send(await bookingPayload(resource._id, { startTime, endTime }));
      assert.equal(res.status, 409, `${startTime}-${endTime}`);
      assert.equal(res.body.code, 'BOOKING_CONFLICT');
    }
    // Touching intervals do not overlap.
    assert.equal((await b.agent.post('/api/bookings').send(await bookingPayload(resource._id, { startTime: '12:00', endTime: '13:00' }))).status, 201);
    assert.equal((await b.agent.post('/api/bookings').send(await bookingPayload(resource._id, { startTime: '09:00', endTime: '10:00', date: await localDate(2) }))).status, 201);
  });

  it('still detects overlap after the resource slot size changes', async () => {
    const { admin, resource, a, b } = await setup();
    assert.equal((await a.agent.post('/api/bookings').send(await bookingPayload(resource._id, { startTime: '10:30', endTime: '11:00' }))).status, 201);
    await admin.patch(`/api/resources/${resource._id}`).send({ bookingRules: { slotMinutes: 60, minDurationMinutes: 60, maxDurationMinutes: 120 } });
    const res = await b.agent.post('/api/bookings').send(await bookingPayload(resource._id, { startTime: '10:00', endTime: '11:00' }));
    assert.equal(res.status, 409);
  });

  it('enforces per-resource and campus-wide active booking limits', async () => {
    const { resource, a } = await setup({ bookingRules: { maxActiveBookingsPerUser: 2 } });
    for (const startTime of ['08:00', '09:00']) {
      const res = await a.agent.post('/api/bookings').send(await bookingPayload(resource._id, { startTime, endTime: startTime.replace(':00', ':30') }));
      assert.equal(res.status, 201);
    }
    const third = await a.agent.post('/api/bookings').send(await bookingPayload(resource._id, { startTime: '12:00', endTime: '12:30' }));
    assert.equal(third.status, 422);
    assert.equal(third.body.code, 'BOOKING_LIMIT_EXCEEDED');

    await SystemPolicy.updateOne({ key: 'default' }, { 'maxActiveBookingsByRole.STUDENT': 2 });
    const { agent: admin2 } = await createUserAgent('ADMIN');
    const other = await createResource(admin2, { name: 'Computer Lab 2' });
    const campus = await a.agent.post('/api/bookings').send(await bookingPayload(other._id, { startTime: '14:00', endTime: '15:00' }));
    assert.equal(campus.status, 422);
    assert.match(campus.body.message, /maximum for your role is 2/);
  });

  it('prevents a user holding two overlapping bookings on different resources', async () => {
    const { admin, resource, a } = await setup();
    const other = await createResource(admin, { name: 'Electronics Lab' });
    assert.equal((await a.agent.post('/api/bookings').send(await bookingPayload(resource._id))).status, 201);
    const res = await a.agent.post('/api/bookings').send(await bookingPayload(other._id, { startTime: '10:30', endTime: '11:30' }));
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'USER_OVERLAP');
  });

  it('rejects restricted users with 403', async () => {
    const { resource, a } = await setup();
    await Restriction.create({ user: a.user._id, source: 'ADMIN', reason: 'Testing', startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 86_400_000) });
    const res = await a.agent.post('/api/bookings').send(await bookingPayload(resource._id));
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'USER_RESTRICTED');
  });
});

describe('concurrency and idempotency', () => {
  it('Test A: many simultaneous requests for the same slot produce exactly one booking', async () => {
    const { resource } = await setup();
    const users = await Promise.all(Array.from({ length: 10 }, () => createUserAgent('STUDENT')));
    const payload = await bookingPayload(resource._id);
    const results = await Promise.all(users.map(({ agent }) => agent.post('/api/bookings').send(payload)));
    const statuses = results.map((r) => r.status).sort();
    assert.equal(statuses.filter((s) => s === 201).length, 1, JSON.stringify(statuses));
    assert.equal(statuses.filter((s) => s === 409).length, 9);
    assert.equal(await Booking.countDocuments({ status: { $ne: 'CANCELLED' } }), 1);
    assert.equal(await SlotLock.countDocuments(), 4, 'no partial locks left behind');
  });

  it('Test A2: simultaneous partially-overlapping requests never both succeed', async () => {
    const { resource } = await setup();
    const users = await Promise.all(Array.from({ length: 6 }, () => createUserAgent('STUDENT')));
    const ranges = [['10:00', '11:00'], ['10:30', '11:30'], ['11:00', '12:00'], ['09:30', '10:30'], ['10:00', '12:00'], ['11:30', '12:30']];
    const date = await localDate(1);
    const results = await Promise.all(
      users.map(async ({ agent }, i) => agent.post('/api/bookings').send(await bookingPayload(resource._id, { date, startTime: ranges[i][0], endTime: ranges[i][1] }))),
    );
    assert.ok(results.some((r) => r.status === 201));
    const booked = await Booking.find({ resource: resource._id, status: 'CONFIRMED' }).sort({ startAt: 1 });
    for (let i = 1; i < booked.length; i += 1) {
      assert.ok(booked[i].startAt >= booked[i - 1].endAt, `overlap between ${booked[i - 1].startTime} and ${booked[i].startTime}`);
    }
  });

  it('Test B: a double-clicked submit with the same Idempotency-Key creates one booking', async () => {
    const { resource, a } = await setup();
    const payload = await bookingPayload(resource._id);
    const key = 'booking-key-12345';
    const [first, second] = await Promise.all([
      a.agent.post('/api/bookings').set('Idempotency-Key', key).send(payload),
      a.agent.post('/api/bookings').set('Idempotency-Key', key).send(payload),
    ]);
    const statuses = [first.status, second.status];
    assert.equal(statuses.filter((s) => s === 201).length, 1, JSON.stringify(statuses));
    assert.ok(statuses.some((s) => s === 200 || s === 409), 'the duplicate is replayed or reported as in progress');
    assert.equal(await Booking.countDocuments(), 1);

    const replay = await a.agent.post('/api/bookings').set('Idempotency-Key', key).send(payload);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.data._id, (await Booking.findOne())._id.toString());
    assert.equal(await Booking.countDocuments(), 1);
  });

  it('concurrent bookings by one user cannot exceed the active limit', async () => {
    const { admin, a } = await setup();
    await SystemPolicy.updateOne({ key: 'default' }, { 'maxActiveBookingsByRole.STUDENT': 2 }, { upsert: true });
    const resources = await Promise.all(['L1', 'L2', 'L3', 'L4', 'L5'].map((name) => createResource(admin, { name })));
    const results = await Promise.all(
      resources.map(async (r, i) => a.agent.post('/api/bookings').send(await bookingPayload(r._id, { startTime: `1${i}:00`, endTime: `1${i}:30` }))),
    );
    const ok = results.filter((r) => r.status === 201).length;
    assert.ok(ok <= 2, `created ${ok} bookings with a limit of 2`);
    assert.ok(await Booking.countDocuments({ user: a.user._id }) <= 2);
  });

  it('reuses a cancelled slot', async () => {
    const { resource, a, b } = await setup();
    const booking = (await a.agent.post('/api/bookings').send(await bookingPayload(resource._id))).body.data;
    assert.equal((await a.agent.post(`/api/bookings/${booking._id}/cancel`).send({ reason: 'Plans changed' })).status, 200);
    assert.equal(await SlotLock.countDocuments(), 0);
    assert.equal((await b.agent.post('/api/bookings').send(await bookingPayload(resource._id))).status, 201);
    clock.reset();
  });
});
