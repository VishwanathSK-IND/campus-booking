import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { app, createUserAgent, request, resetDatabase, setupDatabase, teardownDatabase } from './helpers.js';
import { bookingPayload, createResource } from './fixtures.js';
import { env } from '../config/env.js';

before(setupDatabase);
beforeEach(resetDatabase);
after(teardownDatabase);

describe('authorization and input hardening', () => {
  it('rejects unauthenticated access to protected APIs', async () => {
    for (const [method, url] of [
      ['get', '/api/resources'],
      ['post', '/api/bookings'],
      ['get', '/api/bookings'],
      ['get', '/api/notifications'],
      ['get', '/api/admin/dashboard'],
    ]) {
      assert.equal((await request(app)[method](url)).status, 401, url);
    }
  });

  it('rejects expired JWTs and tokens signed with another secret', async () => {
    const { user } = await createUserAgent('ADMIN');
    const expired = jwt.sign({ sub: String(user._id), exp: Math.floor(Date.now() / 1000) - 60 }, env.JWT_SECRET);
    const forged = jwt.sign({ sub: String(user._id), role: 'ADMIN' }, 'attacker-secret');
    for (const token of [expired, forged]) {
      assert.equal((await request(app).get('/api/admin/dashboard').set('Cookie', `cb_token=${token}`)).status, 401);
    }
  });

  it('students cannot reach admin APIs, approve, or read/modify other users’ data', async () => {
    const { agent: admin } = await createUserAgent('ADMIN');
    const lab = await createResource(admin);
    const owner = await createUserAgent('STUDENT');
    const intruder = await createUserAgent('STUDENT');
    const booking = (await owner.agent.post('/api/bookings').send(await bookingPayload(lab._id))).body.data;

    for (const url of ['/api/admin/dashboard', '/api/admin/users', '/api/admin/bookings', '/api/admin/policy', '/api/admin/audit-logs']) {
      assert.equal((await intruder.agent.get(url)).status, 403, url);
    }
    assert.equal((await intruder.agent.post('/api/admin/jobs/run')).status, 403);
    assert.equal((await intruder.agent.get(`/api/bookings/${booking._id}`)).status, 403);
    assert.equal((await intruder.agent.post(`/api/bookings/${booking._id}/cancel`).send({})).status, 403);
    assert.equal((await intruder.agent.post(`/api/bookings/${booking._id}/approve`).send({})).status, 403);
    assert.equal((await intruder.agent.patch(`/api/admin/users/${owner.user._id}`).send({ role: 'ADMIN' })).status, 403);
    assert.equal((await intruder.agent.post(`/api/admin/users/${owner.user._id}/restrictions`).send({ days: 1, reason: 'spite' })).status, 403);

    // A user's own booking list never contains other users' bookings.
    const mine = await intruder.agent.get('/api/bookings');
    assert.equal(mine.body.data.length, 0);

    // Notifications of another user cannot be marked read.
    const notes = await owner.agent.get('/api/notifications');
    const id = notes.body.data[0]._id;
    assert.equal((await intruder.agent.patch(`/api/notifications/${id}/read`)).status, 404);
  });

  it('faculty cannot access admin configuration', async () => {
    const { agent: faculty } = await createUserAgent('FACULTY');
    assert.equal((await faculty.get('/api/admin/users')).status, 403);
    assert.equal((await faculty.put('/api/admin/policy').send({})).status, 403);
  });

  it('validates ids and query parameters and never returns stack traces', async () => {
    const { agent } = await createUserAgent('STUDENT');
    const malformed = await agent.get('/api/bookings/123');
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.code, 'INVALID_ID');
    assert.equal(malformed.body.stack, undefined);
    assert.equal((await agent.get('/api/resources?page=-1')).status, 400);
    assert.equal((await agent.get('/api/resources?sort=$where')).status, 400);
    assert.equal((await agent.get('/api/bookings/507f1f77bcf86cd799439011')).status, 404);
    // Operator injection in a string field is rejected by schema validation.
    const injection = await agent.post('/api/auth/login').send({ email: { $ne: null }, password: 'x' });
    assert.equal(injection.status, 400);
  });

  it('admin can provision faculty accounts and change roles; admins cannot lock themselves out', async () => {
    const { agent: admin, user: adminUser } = await createUserAgent('ADMIN');
    const res = await admin.post('/api/admin/users').send({ name: 'Dr. Rao', email: 'rao@campus.edu', password: 'Faculty123', role: 'FACULTY' });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.role, 'FACULTY');
    assert.equal(res.body.data.password, undefined);
    assert.equal((await admin.patch(`/api/admin/users/${adminUser._id}`).send({ role: 'STUDENT' })).status, 400);
    const list = await admin.get('/api/admin/users?role=FACULTY');
    assert.equal(list.body.data.length, 1);
    assert.ok(list.body.data.every((u) => u.password === undefined));
  });
});
