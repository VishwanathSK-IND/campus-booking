import { Booking } from '../models/Booking.js';
import { ACTIVE_STATUSES } from '../utils/bookingStateMachine.js';
import { badRequest, conflict, forbidden, unprocessable } from '../utils/AppError.js';
import {
  addDays,
  addMinutes,
  isValidDateString,
  isValidTimeString,
  localToDate,
  timeToMinutes,
  todayLocal,
} from '../utils/time.js';
import { operatingWindow } from './resourceService.js';

/**
 * Priority policy (only when the resource enables facultyPriority):
 *   FACULTY / ADMIN = 2, STUDENT = 1. Otherwise everyone is 0.
 * Priority orders the approval queue and waitlist; it never cancels or
 * overrides an existing booking.
 */
export function computePriority(resource, user) {
  if (!resource.bookingRules.facultyPriority) return 0;
  return user.role === 'STUDENT' ? 1 : 2;
}

export function requiresApproval(resource, user) {
  const rules = resource.bookingRules;
  return Boolean(rules.approvalRequired) && !rules.approvalExemptRoles.includes(user.role);
}

/**
 * Stateless validation of a requested booking against the resource's current
 * status and rules. Returns the computed UTC instants. Conflicts and per-user
 * limits are checked separately because they need database state.
 */
export function validateBookingRequest({ resource, user, date, startTime, endTime, now }) {
  const rules = resource.bookingRules;

  if (resource.status === 'MAINTENANCE') {
    throw conflict('RESOURCE_MAINTENANCE', `${resource.name} is under maintenance and cannot be booked right now`);
  }
  if (resource.status !== 'ACTIVE') {
    throw conflict('RESOURCE_INACTIVE', `${resource.name} is not available for booking`);
  }
  if (!rules.allowedRoles.includes(user.role)) {
    throw forbidden(`${user.role.toLowerCase()} accounts cannot book ${resource.name}`, 'ROLE_NOT_ALLOWED');
  }
  if (!isValidDateString(date)) throw badRequest('INVALID_DATE', 'Date must be a valid YYYY-MM-DD date');
  if (!isValidTimeString(startTime) || !isValidTimeString(endTime)) {
    throw badRequest('INVALID_TIME', 'Times must be in HH:mm format');
  }

  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  if (endMinutes <= startMinutes) throw badRequest('INVALID_TIME', 'End time must be after start time');
  if (startMinutes % rules.slotMinutes || endMinutes % rules.slotMinutes) {
    throw badRequest('INVALID_TIME', `Times must align to ${rules.slotMinutes}-minute slots`);
  }

  const startAt = localToDate(date, startTime);
  const endAt = localToDate(date, endTime);
  if (startAt <= now) throw badRequest('BOOKING_IN_PAST', 'You cannot book a time that has already started');

  const lastDay = addDays(todayLocal(now), rules.maxAdvanceDays);
  if (date > lastDay) {
    throw badRequest('OUTSIDE_BOOKING_WINDOW', `${resource.name} can be booked at most ${rules.maxAdvanceDays} days in advance`);
  }

  const window = operatingWindow(resource, date);
  if (!window) throw badRequest('OUTSIDE_OPERATING_HOURS', `${resource.name} is closed on the selected day`);
  if (startMinutes < window.openMinutes || endMinutes > window.closeMinutes) {
    throw badRequest('OUTSIDE_OPERATING_HOURS', `${resource.name} is open ${window.open}–${window.close} on the selected day`);
  }

  const durationMinutes = endMinutes - startMinutes;
  if (durationMinutes > rules.maxDurationMinutes) {
    throw badRequest('DURATION_EXCEEDED', `Bookings for ${resource.name} can last at most ${rules.maxDurationMinutes} minutes`);
  }
  if (durationMinutes < rules.minDurationMinutes) {
    throw badRequest('DURATION_TOO_SHORT', `Bookings for ${resource.name} must last at least ${rules.minDurationMinutes} minutes`);
  }

  return { startAt, endAt, durationMinutes };
}

/** Rules in force at booking time, stored on the booking (policy snapshot). */
export function policySnapshot(resource, startAt, endAt) {
  const rules = resource.bookingRules;
  const closes = addMinutes(startAt, rules.checkInGraceMinutes);
  return {
    checkInOpensAt: addMinutes(startAt, -rules.checkInOpensBeforeMinutes),
    checkInClosesAt: closes < endAt ? closes : endAt,
    cancellationDeadlineAt: addMinutes(startAt, -rules.cancellationDeadlineMinutes),
  };
}

/**
 * Per-user active booking limits (campus-wide by role, and per resource).
 * `pending` = true before inserting (counts the booking about to be created);
 * false afterwards (the new booking is already counted). The post-insert check
 * is what makes the limit hold under concurrent requests.
 */
export async function assertBookingLimits({ user, resource, policy, now, session = null, pending }) {
  const filter = { user: user._id, status: { $in: ACTIVE_STATUSES }, endAt: { $gt: now } };
  const [total, forResource] = await Promise.all([
    Booking.countDocuments(filter, { session }),
    Booking.countDocuments({ ...filter, resource: resource._id }, { session }),
  ]);
  const extra = pending ? 1 : 0;
  const maxTotal = policy.maxActiveBookingsByRole?.[user.role] ?? 5;
  if (total + extra > maxTotal) {
    throw unprocessable(
      'BOOKING_LIMIT_EXCEEDED',
      `You already have ${total - (pending ? 0 : 1)} active booking(s). The maximum for your role is ${maxTotal}.`,
    );
  }
  const maxForResource = resource.bookingRules.maxActiveBookingsPerUser;
  if (forResource + extra > maxForResource) {
    throw unprocessable(
      'BOOKING_LIMIT_EXCEEDED',
      `You can hold at most ${maxForResource} active booking(s) for ${resource.name} at a time.`,
    );
  }
}

/** A user cannot hold two overlapping active bookings (they cannot be in two places at once). */
export async function assertNoUserOverlap(userId, startAt, endAt, { session = null, excluding } = {}) {
  const filter = {
    user: userId,
    status: { $in: ACTIVE_STATUSES },
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  };
  if (excluding) filter._id = { $ne: excluding };
  const overlapping = await Booking.findOne(filter, null, { session }).select('code resourceSnapshot startTime endTime');
  if (overlapping) {
    throw conflict(
      'USER_OVERLAP',
      `You already have ${overlapping.resourceSnapshot?.name || 'a booking'} booked ${overlapping.startTime}–${overlapping.endTime} at this time (${overlapping.code})`,
    );
  }
}
