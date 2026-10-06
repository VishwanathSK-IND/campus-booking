import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createUserAgent, localDate, resetDatabase, setupDatabase, teardownDatabase } from './helpers.js';
import { bookingPayload, createResource, resourcePayload } from './fixtures.js';
import { AuditLog } from '../models/AuditLog.js';

before(setupDatabase);
beforeEach(resetDatabase);
after(teardownDatabase);

describe('resources', () => {
  it('only admins can create and edit resources; creation is audited', async () => {
    const { agent: student } = await createUserAgent('STUDENT');
    const { agent: faculty } = await createUserAgent('FACULTY');
    const { agent: admin } = await createUserAgent('ADMIN');

    assert.equal((await student.post('/api/resources').send(resourcePayload())).status, 403);
    assert.equal((await faculty.post('/api/resources').send(resourcePayload())).status, 403);

    const resource = await createResource(admin);
    assert.equal(resource.status, 'ACTIVE');
    assert.equal(await AuditLog.countDocuments({ action: 'RESOURCE_CREATED' }), 1);

    assert.equal((await student.patch(`/api/resources/${resource._id}`).send({ name: 'Hacked' })).status, 403);
    const edit = await admin.patch(`/api/resources/${resource._id}`).send({ bookingRules: { maxDurationMinutes: 60 } });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.data.bookingRules.maxDurationMinutes, 60);
    assert.equal(edit.body.data.bookingRules.slotMinutes, 30, 'partial rule updates keep other rules');
  });

  it('validates resource input', async () => {
    const { agent: admin } = await createUserAgent('ADMIN');
    const bad = [
      resourcePayload({ category: 'SPACESHIP' }),
      resourcePayload({ capacity: -5 }),
      resourcePayload({ operatingHours: [{ day: 1, open: '18:00', close: '09:00' }] }),
      resourcePayload({ bookingRules: { minDurationMinutes: 120, maxDurationMinutes: 60 } }),
      resourcePayload({ bookingRules: { slotMinutes: 60, maxDurationMinutes: 90 } }),
    ];
    for (const payload of bad) {
      const res = await admin.post('/api/resources').send(payload);
      assert.equal(res.status, 400, JSON.stringify(payload).slice(0, 80));
    }
  });

  it('supports search, filters, sorting and pagination with one dynamic query', async () => {
    const { agent: admin } = await createUserAgent('ADMIN');
    await createResource(admin, { name: 'Computer Lab 1', location: 'Block A' });
    await createResource(admin, { name: 'Computer Lab 2', location: 'Block B' });
    await createResource(admin, { name: 'Seminar Hall A', category: 'HALL', location: 'Block A', capacity: 200 });
    const hidden = await createResource(admin, { name: 'Old Lab', location: 'Block C' });
    await admin.patch(`/api/resources/${hidden._id}/status`).send({ status: 'INACTIVE' });

    const { agent: student } = await createUserAgent('STUDENT');
    const search = await student.get('/api/resources?search=computer');
    assert.deepEqual(search.body.data.map((r) => r.name), ['Computer Lab 1', 'Computer Lab 2']);

    const combined = await student.get('/api/resources?search=lab&category=LAB&location=block-a'.replace('block-a', 'Block%20A'));
    assert.deepEqual(combined.body.data.map((r) => r.name), ['Computer Lab 1']);

    const halls = await student.get('/api/resources?category=HALL');
    assert.equal(halls.body.data.length, 1);

    const paged = await student.get('/api/resources?limit=2&page=2&sort=name');
    assert.equal(paged.body.meta.total, 3, 'inactive resources are hidden from students');
    assert.equal(paged.body.data.length, 1);

    const adminAll = await admin.get('/api/resources?status=INACTIVE');
    assert.equal(adminAll.body.data[0].name, 'Old Lab');
    assert.equal((await student.get(`/api/resources/${hidden._id}`)).status, 404);

    assert.equal((await student.get('/api/resources?category=NOPE')).status, 400);
    assert.equal((await student.get('/api/resources/not-an-id')).status, 400);
  });

  it('filters by availability for a requested interval', async () => {
    const { agent: admin } = await createUserAgent('ADMIN');
    const lab1 = await createResource(admin, { name: 'Computer Lab 1' });
    await createResource(admin, { name: 'Computer Lab 2' });
    const { agent: student } = await createUserAgent('STUDENT');
    const date = await localDate(1);
    assert.equal((await student.post('/api/bookings').send(await bookingPayload(lab1._id, { date }))).status, 201);

    const free = await student.get(`/api/resources?date=${date}&startTime=10:30&endTime=11:30`);
    assert.deepEqual(free.body.data.map((r) => r.name), ['Computer Lab 2']);
    const later = await student.get(`/api/resources?date=${date}&startTime=11:00&endTime=12:00`);
    assert.equal(later.body.data.length, 2);
  });

  it('returns real slot availability including booked, pending, blocked and maintenance states', async () => {
    const { agent: admin } = await createUserAgent('ADMIN');
    const lab = await createResource(admin, { operatingHours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '09:00', close: '13:00' })) });
    const { agent: student } = await createUserAgent('STUDENT');
    const date = await localDate(1);

    await student.post('/api/bookings').send(await bookingPayload(lab._id, { date, startTime: '10:00', endTime: '11:00' }));
    const block = await admin.post(`/api/resources/${lab._id}/blocks`).send({ date, startTime: '12:00', endTime: '13:00', reason: 'Lab exam' });
    assert.equal(block.status, 201);

    const res = await student.get(`/api/resources/${lab._id}/availability?date=${date}`);
    assert.equal(res.status, 200);
    const byTime = Object.fromEntries(res.body.data.slots.map((s) => [s.startTime, s.status]));
    assert.deepEqual(byTime, {
      '09:00': 'AVAILABLE',
      '09:30': 'AVAILABLE',
      '10:00': 'BOOKED',
      '10:30': 'BOOKED',
      '11:00': 'AVAILABLE',
      '11:30': 'AVAILABLE',
      '12:00': 'BLOCKED',
      '12:30': 'BLOCKED',
    });
    assert.ok(res.body.data.slots.find((s) => s.startTime === '10:00').mine);
    assert.deepEqual(
      res.body.data.intervals.map((i) => `${i.startTime}-${i.endTime} ${i.status}`),
      ['09:00-10:00 AVAILABLE', '10:00-11:00 BOOKED', '11:00-12:00 AVAILABLE', '12:00-13:00 BLOCKED'],
    );

    // Block overlapping an existing booking is refused.
    const clash = await admin.post(`/api/resources/${lab._id}/blocks`).send({ date, startTime: '10:30', endTime: '11:30', reason: 'Event' });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.code, 'BLOCK_CONFLICT');

    await admin.patch(`/api/resources/${lab._id}/status`).send({ status: 'MAINTENANCE', reason: 'AC repair' });
    const maint = await student.get(`/api/resources/${lab._id}/availability?date=${date}`);
    assert.equal(maint.body.data.slots.find((s) => s.startTime === '09:00').status, 'MAINTENANCE');
    assert.equal(maint.body.data.slots.find((s) => s.startTime === '10:00').status, 'BOOKED', 'existing bookings kept unless cancelled');
  });

  it('maintenance with cancelExistingBookings cancels and notifies, never deletes', async () => {
    const { agent: admin } = await createUserAgent('ADMIN');
    const lab = await createResource(admin);
    const { agent: student } = await createUserAgent('STUDENT');
    const booking = (await student.post('/api/bookings').send(await bookingPayload(lab._id))).body.data;

    const res = await admin
      .patch(`/api/resources/${lab._id}/status`)
      .send({ status: 'MAINTENANCE', reason: 'Flooding', cancelExistingBookings: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.cancelledBookings, 1);

    const detail = await student.get(`/api/bookings/${booking._id}`);
    assert.equal(detail.body.data.status, 'CANCELLED');
    assert.match(detail.body.data.cancellationReason, /maintenance: Flooding/);
    const notes = await student.get('/api/notifications');
    assert.ok(notes.body.data.some((n) => n.type === 'BOOKING_CANCELLED'));
  });
});
