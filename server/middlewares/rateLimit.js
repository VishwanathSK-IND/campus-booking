import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const passthrough = (_req, _res, next) => next();

function limiter(options) {
  if (!env.RATE_LIMIT_ENABLED) return passthrough;
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please slow down and try again shortly.',
      }),
    ...options,
  });
}

export const authLimiter = limiter({ windowMs: 15 * 60 * 1000, limit: 30 });
export const apiLimiter = limiter({ windowMs: 60 * 1000, limit: 300 });
