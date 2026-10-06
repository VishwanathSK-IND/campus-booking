import { parseCookie } from 'cookie';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { AUTH_COOKIE, env } from '../config/env.js';
import { userFromToken } from '../middlewares/auth.js';
import { logger } from '../utils/logger.js';
import { rooms, setIo } from './io.js';

/**
 * Socket.IO is authenticated with the same HttpOnly JWT cookie as the REST
 * API. Each user joins a private room; staff join the approval room; clients
 * subscribe to the resources whose availability they are viewing.
 */
export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.CLIENT_URLS, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie || '');
      const user = await userFromToken(cookies[AUTH_COOKIE]);
      if (!user) return next(new Error('UNAUTHORIZED'));
      socket.data.user = { _id: String(user._id), role: user.role };
      next();
    } catch (error) {
      next(error);
    }
  });

  io.on('connection', (socket) => {
    const { user } = socket.data;
    socket.join(rooms.user(user._id));
    if (user.role === 'ADMIN' || user.role === 'FACULTY') socket.join(rooms.staff);

    socket.on('resource:watch', (resourceId) => {
      if (typeof resourceId === 'string' && mongoose.isValidObjectId(resourceId)) socket.join(rooms.resource(resourceId));
    });
    socket.on('resource:unwatch', (resourceId) => {
      if (typeof resourceId === 'string') socket.leave(rooms.resource(resourceId));
    });
  });

  io.engine.on('connection_error', (error) => logger.warn('Socket connection error', error.message));
  setIo(io);
  return io;
}
