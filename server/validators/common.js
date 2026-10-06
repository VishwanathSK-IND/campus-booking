import { z } from 'zod';
import { isValidDateString, TIME_RE } from '../utils/time.js';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const dateString = z.string().refine(isValidDateString, 'Date must be a valid YYYY-MM-DD date');
export const timeString = z.string().regex(TIME_RE, 'Time must be HH:mm (24-hour)');

export const pagination = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(12),
};

export const optionalTrimmed = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

export const booleanQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));
