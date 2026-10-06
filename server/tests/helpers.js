// Test bootstrap: must be imported before any application module.
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/campus_booking_test';
process.env.APP_TIMEZONE = 'Asia/Kolkata';

const { default: mongoose } = await import('mongoose');
const { default: request } = await import('supertest');
const { createApp } = await import('../app.js');
const { connectDatabase } = await import('../config/db.js');
const { User } = await import('../models/User.js');
const { hashPassword } = await import('../services/authService.js');
const { clock } = await import('../utils/clock.js');

export const app = createApp();
export { clock, mongoose, request };

export async function setupDatabase() {
  await connectDatabase(process.env.MONGO_URI);
}

export async function resetDatabase() {
  clock.reset();
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

export async function teardownDatabase() {
  clock.reset();
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
}

let counter = 0;
const PASSWORD = 'Password123';

/** Creates a user directly (any role) and returns a logged-in supertest agent. */
export async function createUserAgent(role = 'STUDENT', overrides = {}) {
  counter += 1;
  const email = overrides.email || `${role.toLowerCase()}${counter}@campus.test`;
  const user = await User.create({
    name: overrides.name || `${role} ${counter}`,
    email,
    role,
    password: await hashPassword(PASSWORD),
  });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user };
}

/** A local date (YYYY-MM-DD) N days from "now" in the campus timezone. */
export async function localDate(daysFromNow = 1) {
  const { addDays, todayLocal } = await import('../utils/time.js');
  return addDays(todayLocal(clock.now()), daysFromNow);
}
