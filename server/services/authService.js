import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { AppError, conflict } from '../utils/AppError.js';
import { clock } from '../utils/clock.js';

const SALT_ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 12;
// Used to keep login timing similar whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-password', SALT_ROUNDS);

export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Self-registration always creates a STUDENT account. Faculty and admin
 * accounts are provisioned by an administrator (or the create-admin script),
 * so nobody can grant themselves elevated privileges.
 */
export async function registerUser({ name, email, password, department }) {
  if (await User.exists({ email })) {
    throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
  }
  try {
    return await User.create({
      name,
      email,
      department,
      password: await hashPassword(password),
      role: 'STUDENT',
    });
  } catch (error) {
    if (error?.code === 11000) throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
    throw error;
  }
}

export async function authenticate(email, password) {
  const user = await User.findOne({ email }).select('+password');
  const valid = await bcrypt.compare(password, user?.password || DUMMY_HASH);
  if (!user || !valid || !user.isActive) {
    // Deliberately identical for unknown email, wrong password and disabled accounts.
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  user.lastLoginAt = clock.now();
  await user.save();
  return user;
}
