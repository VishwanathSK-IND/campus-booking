import { z } from 'zod';
import { BOOKING_STATUSES } from '../utils/bookingStateMachine.js';
import { dateString, objectId, optionalTrimmed, pagination, timeString } from './common.js';

export const createBookingSchema = z.object({
  resourceId: objectId,
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  purpose: z.string().trim().min(3, 'Please describe the purpose (at least 3 characters)').max(500),
});

export const idempotencyKeyHeader = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,100}$/, 'Idempotency-Key must be 8–100 characters of letters, digits, - or _')
  .optional();

export const approveSchema = z.object({ note: optionalTrimmed(500) });
export const rejectSchema = z.object({ reason: z.string().trim().min(3, 'A rejection reason is required').max(500) });
export const cancelSchema = z.object({ reason: optionalTrimmed(500) });

export const myBookingsQuery = z.object({
  ...pagination,
  scope: z.enum(['upcoming', 'pending', 'completed', 'cancelled', 'noshow', 'all']).default('all'),
  status: z.enum(BOOKING_STATUSES).optional(),
  resource: objectId.optional(),
});

export const pendingApprovalsQuery = z.object({ ...pagination, resource: objectId.optional() });

export const adminBookingsQuery = z.object({
  ...pagination,
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: optionalTrimmed(100),
  resource: objectId.optional(),
  user: objectId.optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
  approvalStatus: z.enum(['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED']).optional(),
  date: dateString.optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  sort: z.enum(['startAt', '-startAt', 'createdAt']).default('-startAt'),
});

export const joinWaitlistSchema = createBookingSchema;
export const myWaitlistQuery = z.object({
  ...pagination,
  status: z.enum(['active', 'WAITING', 'OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED']).optional(),
});
