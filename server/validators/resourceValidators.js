import { z } from 'zod';
import { RESOURCE_CATEGORIES, RESOURCE_STATUSES } from '../models/Resource.js';
import { ROLES } from '../models/User.js';
import { timeToMinutes } from '../utils/time.js';
import { booleanQuery, dateString, objectId, optionalTrimmed, pagination, timeString } from './common.js';

const quarterAligned = (t) => timeToMinutes(t) % 15 === 0;

const operatingHours = z
  .array(
    z
      .object({
        day: z.number().int().min(0).max(6),
        open: timeString.refine(quarterAligned, 'Opening time must be on a 15-minute boundary'),
        close: timeString.refine(quarterAligned, 'Closing time must be on a 15-minute boundary'),
      })
      .refine((h) => timeToMinutes(h.close) > timeToMinutes(h.open), {
        message: 'Closing time must be after opening time',
        path: ['close'],
      }),
  )
  .max(7)
  .refine((hours) => new Set(hours.map((h) => h.day)).size === hours.length, 'Each day may appear only once');

const roleList = z.array(z.enum(ROLES)).max(3);

const bookingRules = z
  .object({
    slotMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    minDurationMinutes: z.number().int().min(15).max(24 * 60),
    maxDurationMinutes: z.number().int().min(15).max(24 * 60),
    maxAdvanceDays: z.number().int().min(0).max(365),
    maxActiveBookingsPerUser: z.number().int().min(1).max(100),
    allowedRoles: roleList.min(1, 'At least one role must be allowed'),
    approvalRequired: z.boolean(),
    approvalExemptRoles: roleList,
    facultyPriority: z.boolean(),
    cancellationDeadlineMinutes: z.number().int().min(0).max(7 * 24 * 60),
    checkInOpensBeforeMinutes: z.number().int().min(0).max(120),
    checkInGraceMinutes: z.number().int().min(1).max(120),
  })
  .partial();

function checkRules(rules, ctx) {
  if (!rules) return;
  const slot = rules.slotMinutes ?? 30;
  const min = rules.minDurationMinutes;
  const max = rules.maxDurationMinutes;
  if (min !== undefined && max !== undefined && min > max) {
    ctx.addIssue({ code: 'custom', path: ['bookingRules', 'minDurationMinutes'], message: 'Minimum duration cannot exceed maximum duration' });
  }
  for (const [key, value] of [['minDurationMinutes', min], ['maxDurationMinutes', max]]) {
    if (value !== undefined && value % slot !== 0) {
      ctx.addIssue({ code: 'custom', path: ['bookingRules', key], message: `Must be a multiple of the ${slot}-minute slot length` });
    }
  }
}

const resourceFields = {
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
  category: z.enum(RESOURCE_CATEGORIES),
  location: z.string().trim().min(2).max(120),
  capacity: z.number().int().min(0).max(10_000).optional(),
  facilities: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  operatingHours: operatingHours.min(1, 'At least one day of operating hours is required'),
  bookingRules: bookingRules.optional(),
  approvers: z.array(objectId).max(20).optional(),
};

export const createResourceSchema = z.object(resourceFields).superRefine((data, ctx) => checkRules(data.bookingRules, ctx));

export const updateResourceSchema = z
  .object(resourceFields)
  .partial()
  .superRefine((data, ctx) => checkRules(data.bookingRules, ctx))
  .refine((data) => Object.keys(data).length > 0, 'Provide at least one field to update');

export const resourceStatusSchema = z.object({
  status: z.enum(RESOURCE_STATUSES),
  reason: z.string().trim().max(300).optional(),
  cancelExistingBookings: z.boolean().default(false),
});

export const blockSchema = z
  .object({
    date: dateString,
    startTime: timeString.refine(quarterAligned, 'Must be on a 15-minute boundary'),
    endTime: timeString.refine(quarterAligned, 'Must be on a 15-minute boundary'),
    reason: z.string().trim().min(3).max(200),
  })
  .refine((b) => timeToMinutes(b.endTime) > timeToMinutes(b.startTime), {
    message: 'End time must be after start time',
    path: ['endTime'],
  });

export const listResourcesQuery = z
  .object({
    ...pagination,
    search: optionalTrimmed(100),
    category: z.enum(RESOURCE_CATEGORIES).optional(),
    location: optionalTrimmed(120),
    status: z.enum(RESOURCE_STATUSES).optional(),
    minCapacity: z.coerce.number().int().min(0).optional(),
    approvalRequired: booleanQuery,
    // Availability filter: only resources free for the whole interval.
    date: dateString.optional(),
    startTime: timeString.optional(),
    endTime: timeString.optional(),
    sort: z.enum(['name', '-name', 'capacity', '-capacity', 'createdAt', '-createdAt']).default('name'),
  })
  .refine((q) => (q.startTime || q.endTime ? Boolean(q.date && q.startTime && q.endTime) : true), {
    message: 'Availability filter needs date, startTime and endTime together',
    path: ['startTime'],
  })
  .refine((q) => (q.startTime && q.endTime ? timeToMinutes(q.endTime) > timeToMinutes(q.startTime) : true), {
    message: 'End time must be after start time',
    path: ['endTime'],
  });

export const availabilityQuery = z.object({ date: dateString });
