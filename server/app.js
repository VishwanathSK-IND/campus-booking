import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { apiLimiter } from './middlewares/rateLimit.js';
import adminRoutes from './routes/adminRoutes.js';
import authRoutes from './routes/authRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import resourceRoutes from './routes/resourceRoutes.js';
import userRoutes from './routes/userRoutes.js';
import waitlistRoutes from './routes/waitlistRoutes.js';

export function createApp() {
  const app = express();

  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Non-browser clients (curl, Postman) send no Origin header.
        if (!origin || env.CLIENT_URLS.includes(origin)) return callback(null, true);
        return callback(null, false);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (!env.isTest) app.use(morgan(env.isProd ? 'combined' : 'dev'));

  app.get('/api/health', (_req, res) => res.json({ success: true, message: 'OK', data: { status: 'up' } }));

  app.use('/api', apiLimiter);
  app.use('/api/auth', authRoutes);
  app.use('/api/resources', resourceRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/waitlists', waitlistRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
