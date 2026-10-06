import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

function secret(name, devFallback) {
  const value = process.env[name];
  if (value) return value;
  if (isProd) throw new Error(`Missing required environment variable ${name}`);
  return devFallback;
}

function bool(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes'].includes(value.toLowerCase());
}

export const env = {
  NODE_ENV,
  isProd,
  isTest: NODE_ENV === 'test',
  PORT: Number(process.env.PORT) || 5000,
  MONGO_URI: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/campus_booking',
  JWT_SECRET: secret('JWT_SECRET', 'dev-only-jwt-secret-change-me'),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  QR_TOKEN_SECRET: secret('QR_TOKEN_SECRET', 'dev-only-qr-secret-change-me'),
  QR_TOKEN_TTL_SECONDS: Number(process.env.QR_TOKEN_TTL_SECONDS) || 90,
  CLIENT_URLS: (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean),
  APP_TIMEZONE: process.env.APP_TIMEZONE || 'Asia/Kolkata',
  COOKIE_SECURE: bool('COOKIE_SECURE', isProd),
  // Cross-site deployments (frontend and API on different domains) need SameSite=None.
  COOKIE_SAMESITE: process.env.COOKIE_SAMESITE || (isProd ? 'none' : 'lax'),
  JOBS_ENABLED: bool('JOBS_ENABLED', NODE_ENV !== 'test'),
  JOBS_CRON: process.env.JOBS_CRON || '* * * * *',
  RATE_LIMIT_ENABLED: bool('RATE_LIMIT_ENABLED', NODE_ENV !== 'test'),
  TRUST_PROXY: bool('TRUST_PROXY', isProd),
};

export const AUTH_COOKIE = 'cb_token';
