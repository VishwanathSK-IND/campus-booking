import jwt from 'jsonwebtoken';
import { env, AUTH_COOKIE } from '../config/env.js';
import { User } from '../models/User.js';
import { forbidden, unauthorized } from '../utils/AppError.js';

export function signAuthToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

/** Resolves a JWT to an active user, or null. Shared by HTTP and Socket.IO auth. */
export async function userFromToken(token) {
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    return null;
  }
  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) return null;
  return user;
}

/**
 * Cookie → verify JWT → load user → req.user. The role on req.user always
 * comes from the database, never from the token or the client.
 */
export async function requireAuth(req, _res, next) {
  const user = await userFromToken(req.cookies?.[AUTH_COOKIE]);
  if (!user) return next(unauthorized());
  req.user = user;
  next();
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export const cookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAMESITE,
  path: '/',
});
