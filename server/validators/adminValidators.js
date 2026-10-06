import { z } from 'zod';
import { ROLES } from '../models/User.js';
import { clock } from '../utils/clock.js';
import { addDays, todayLocal } from '../utils/time.js';
import { registerSchema } from './authValidators.js';
import { booleanQuery, dateString, objectId, optionalTrimmed, pagination } from './common.js';

export const listUsersQuery = z.object({
  ...pagination,
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: optionalTrimmed(100),
  role: z.enum(ROLES).optional(),
  restricted: booleanQuery,
  active: booleanQuery,
});

export const createUserSchema = registerSchema.extend({ role: z.enum(ROLES) });

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    department: z.string().trim().max(100),
    role: z.enum(ROLES),
    isActive: z.boolean(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'Provide at least one field to update');

export const restrictionSchema = z.object({
  days: z.number().int().min(1).max(365),
  reason: z.string().trim().min(3).max(500),
});

export const liftRestrictionSchema = z.object({ reason: optionalTrimmed(500) });

export const analyticsQuery = z
  .object({
    from: dateString.optional(),
    to: dateString.optional(),
    resource: objectId.optional(),
  })
  .transform((q) => {
    const to = q.to || todayLocal(clock.now());
    return { ...q, to, from: q.from || addDays(to, -29) };
  })
  .refine((q) => q.from <= q.to, { message: '"from" must be on or before "to"', path: ['from'] })
  .refine((q) => q.from >= addDays(q.to, -366), { message: 'Range can be at most one year', path: ['from'] });

const tier = z.object({
  threshold: z.number().int().min(1).max(50),
  action: z.enum(['WARNING', 'RESTRICTION']),
  restrictionDays: z.number().int().min(0).max(365),
});

export const policySchema = z.object({
  maxActiveBookingsByRole: z
    .object({ STUDENT: z.number().int().min(1).max(100), FACULTY: z.number().int().min(1).max(100), ADMIN: z.number().int().min(1).max(500) })
    .partial()
    .optional(),
  noShow: z
    .object({
      lookbackDays: z.number().int().min(1).max(365),
      tiers: z
        .array(tier)
        .min(1)
        .max(10)
        .refine((t) => new Set(t.map((x) => x.threshold)).size === t.length, 'Tier thresholds must be unique'),
    })
    .partial()
    .optional(),
  waitlist: z
    .object({ offerMinutes: z.number().int().min(1).max(24 * 60), maxEntriesPerUser: z.number().int().min(1).max(100) })
    .partial()
    .optional(),
  reminders: z
    .object({
      enabled: z.boolean(),
      leadMinutes: z.number().int().min(15).max(7 * 24 * 60),
      checkInLeadMinutes: z.number().int().min(5).max(240),
    })
    .partial()
    .optional(),
});

export const auditQuery = z.object({
  ...pagination,
  limit: z.coerce.number().int().min(1).max(100).default(25),
  action: optionalTrimmed(60),
  entityType: z.enum(['Resource', 'Booking', 'User', 'SystemPolicy']).optional(),
  entityId: objectId.optional(),
});
