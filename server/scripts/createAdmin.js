/**
 * Secure admin provisioning (admins can never self-register).
 *
 *   ADMIN_PASSWORD='S3cure-pass' npm run create-admin -- admin@college.edu "Jane Admin"
 *
 * If the email already exists the account is promoted to ADMIN. Without
 * ADMIN_PASSWORD a random password is generated and printed once.
 */
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/db.js';
import { User } from '../models/User.js';
import { hashPassword } from '../services/authService.js';

const [email, name = 'Administrator'] = process.argv.slice(2);

async function main() {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Usage: npm run create-admin -- <email> [name]');
  await connectDatabase();
  const normalised = email.trim().toLowerCase();
  const existing = await User.findOne({ email: normalised });
  if (existing) {
    existing.role = 'ADMIN';
    existing.isActive = true;
    await existing.save();
    console.log(`Promoted ${normalised} to ADMIN`);
  } else {
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
    if (password.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters');
    await User.create({ name, email: normalised, role: 'ADMIN', password: await hashPassword(password) });
    console.log(`Created ADMIN ${normalised}`);
    if (!process.env.ADMIN_PASSWORD) console.log(`Generated password (shown once): ${password}`);
  }
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect();
  process.exit(1);
});
