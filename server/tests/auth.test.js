import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { app, createUserAgent, request, resetDatabase, setupDatabase, teardownDatabase } from './helpers.js';
import { User } from '../models/User.js';

before(setupDatabase);
beforeEach(resetDatabase);
after(teardownDatabase);

describe('authentication', () => {
  const valid = { name: 'Asha Rao', email: '  Asha@Campus.edu ', password: 'Secret123' };

  it('registers a student, normalises email, hashes password and never returns it', async () => {
    const res = await request(app).post('/api/auth/register').send(valid);
    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.user.email, 'asha@campus.edu');
    assert.equal(res.body.data.user.role, 'STUDENT');
    assert.equal(res.body.data.user.password, undefined);
    assert.match(res.headers['set-cookie'][0], /cb_token=.*HttpOnly/);

    const stored = await User.findOne({ email: 'asha@campus.edu' }).select('+password');
    assert.notEqual(stored.password, valid.password);
    assert.match(stored.password, /^\$2[aby]\$/);
  });

  it('ignores attempts to self-register as ADMIN', async () => {
    const res = await request(app).post('/api/auth/register').send({ ...valid, role: 'ADMIN' });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.user.role, 'STUDENT');
  });

  it('rejects duplicate emails with 409', async () => {
    await request(app).post('/api/auth/register').send(valid);
    const res = await request(app).post('/api/auth/register').send({ ...valid, email: 'asha@campus.edu' });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'EMAIL_TAKEN');
  });

  it('validates registration input', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'A', email: 'nope', password: 'short' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
  });

  it('logs in, exposes /me, and logs out', async () => {
    await request(app).post('/api/auth/register').send(valid);
    const agent = request.agent(app);

    const login = await agent.post('/api/auth/login').send({ email: 'asha@campus.edu', password: 'Secret123' });
    assert.equal(login.status, 200);
    assert.equal(login.body.data.user.password, undefined);

    const me = await agent.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.data.user.email, 'asha@campus.edu');

    assert.equal((await agent.post('/api/auth/logout')).status, 200);
    assert.equal((await agent.get('/api/auth/me')).status, 401);
  });

  it('uses the same 401 message for unknown email and wrong password', async () => {
    await request(app).post('/api/auth/register').send(valid);
    const wrongPassword = await request(app).post('/api/auth/login').send({ email: 'asha@campus.edu', password: 'Wrong1234' });
    const unknownEmail = await request(app).post('/api/auth/login').send({ email: 'nobody@campus.edu', password: 'Wrong1234' });
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    assert.equal(wrongPassword.body.message, unknownEmail.body.message);
  });

  it('rejects missing, invalid and tampered tokens', async () => {
    assert.equal((await request(app).get('/api/auth/me')).status, 401);
    const bad = await request(app).get('/api/auth/me').set('Cookie', 'cb_token=not-a-jwt');
    assert.equal(bad.status, 401);
  });

  it('rejects deactivated users even with a valid token', async () => {
    const { agent, user } = await createUserAgent('STUDENT');
    await User.updateOne({ _id: user._id }, { isActive: false });
    assert.equal((await agent.get('/api/auth/me')).status, 401);
  });

  it('returns 400 for malformed JSON and 413 for oversized bodies', async () => {
    const malformed = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad');
    assert.equal(malformed.status, 400);
    const huge = await request(app).post('/api/auth/register').send({ ...valid, name: 'x'.repeat(200_000) });
    assert.equal(huge.status, 413);
  });
});
