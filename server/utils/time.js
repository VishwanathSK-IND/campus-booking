import { DateTime } from 'luxon';
import { env } from '../config/env.js';

/**
 * All campus times (operating hours, booking start/end) are wall-clock times in
 * the campus timezone. Instants are stored as UTC Dates (startAt/endAt) while
 * the original local date/time strings are kept for display and history.
 */
export const TZ = env.APP_TIMEZONE;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;

export function isValidDateString(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
  return DateTime.fromISO(date, { zone: TZ }).isValid;
}

export function isValidTimeString(time) {
  return typeof time === 'string' && TIME_RE.test(time);
}

export function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Converts a campus-local date + HH:mm (24:00 allowed) to a UTC Date. */
export function localToDate(date, time) {
  const start = DateTime.fromISO(date, { zone: TZ }).startOf('day');
  return start.plus({ minutes: timeToMinutes(time) }).toJSDate();
}

export function toLocalParts(instant) {
  const dt = DateTime.fromJSDate(instant, { zone: TZ });
  return { date: dt.toISODate(), time: dt.toFormat('HH:mm') };
}

export function todayLocal(now = new Date()) {
  return DateTime.fromJSDate(now, { zone: TZ }).toISODate();
}

/** 0 = Sunday ... 6 = Saturday (matches JavaScript getDay()). */
export function dayOfWeek(date) {
  return DateTime.fromISO(date, { zone: TZ }).weekday % 7;
}

export function addDays(date, days) {
  return DateTime.fromISO(date, { zone: TZ }).plus({ days }).toISODate();
}

export function startOfLocalDay(date) {
  return DateTime.fromISO(date, { zone: TZ }).startOf('day').toJSDate();
}

export function formatLocal(instant, format = 'dd LLL yyyy, HH:mm') {
  return DateTime.fromJSDate(instant, { zone: TZ }).toFormat(format);
}

/** Every slot start in [startAt, endAt) for the given slot length. */
export function slotStartsBetween(startAt, endAt, slotMinutes) {
  const slots = [];
  const step = slotMinutes * 60 * 1000;
  for (let t = startAt.getTime(); t < endAt.getTime(); t += step) {
    slots.push(new Date(t));
  }
  return slots;
}

export function addMinutes(instant, minutes) {
  return new Date(instant.getTime() + minutes * 60 * 1000);
}
