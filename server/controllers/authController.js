import { AUTH_COOKIE } from '../config/env.js';
import { cookieOptions, signAuthToken } from '../middlewares/auth.js';
import { publicUser } from '../models/User.js';
import { authenticate, registerUser } from '../services/authService.js';
import { created, ok } from '../utils/respond.js';

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

function setAuthCookie(res, user) {
  res.cookie(AUTH_COOKIE, signAuthToken(user), { ...cookieOptions(), maxAge: SEVEN_DAYS });
}

export async function register(req, res) {
  const user = await registerUser(req.valid.body);
  setAuthCookie(res, user);
  created(res, { user: publicUser(user) }, 'Account created successfully');
}

export async function login(req, res) {
  const { email, password } = req.valid.body;
  const user = await authenticate(email, password);
  setAuthCookie(res, user);
  ok(res, { user: publicUser(user) }, 'Logged in successfully');
}

export async function logout(_req, res) {
  res.clearCookie(AUTH_COOKIE, cookieOptions());
  ok(res, null, 'Logged out successfully');
}

export async function me(req, res) {
  ok(res, { user: publicUser(req.user) });
}
