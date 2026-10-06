import { Booking } from '../models/Booking.js';
import { SlotLock } from '../models/SlotLock.js';
import { clock } from '../utils/clock.js';
import { addMinutes, localToDate, minutesToTime, TZ, todayLocal, addDays } from '../utils/time.js';
import { operatingWindow } from './resourceService.js';

/**
 * Builds the slot-by-slot availability for one resource and one date from the
 * real slot locks (bookings, admin blocks, waitlist offers), the resource
 * status, operating hours and booking window. Nothing is cached or faked.
 *
 * Slot statuses: AVAILABLE, BOOKED, PENDING (awaiting approval), HELD
 * (offered to a waitlisted user), BLOCKED, MAINTENANCE, UNAVAILABLE, PAST,
 * OUTSIDE_WINDOW (beyond the advance-booking limit).
 */
export async function getAvailability(resource, date, viewer) {
  const now = clock.now();
  const rules = resource.bookingRules;
  const window = operatingWindow(resource, date);
  const base = {
    resourceId: resource._id,
    date,
    timezone: TZ,
    resourceStatus: resource.status,
    slotMinutes: rules.slotMinutes,
    rules: {
      minDurationMinutes: rules.minDurationMinutes,
      maxDurationMinutes: rules.maxDurationMinutes,
      maxAdvanceDays: rules.maxAdvanceDays,
      approvalRequired: rules.approvalRequired,
    },
  };
  if (!window) return { ...base, open: false, slots: [], intervals: [] };

  const dayStart = localToDate(date, window.open);
  const dayEnd = localToDate(date, window.close);
  const locks = await SlotLock.find({ resource: resource._id, slotStart: { $gte: dayStart, $lt: dayEnd } }).lean();
  const lockByTime = new Map(locks.map((l) => [l.slotStart.getTime(), l]));
  const bookingIds = [...new Set(locks.filter((l) => l.ownerType === 'BOOKING').map((l) => String(l.ownerId)))];
  const bookings = await Booking.find({ _id: { $in: bookingIds } }).select('status user').lean();
  const bookingById = new Map(bookings.map((b) => [String(b._id), b]));
  const blockById = new Map(resource.blockedPeriods.map((b) => [String(b._id), b]));
  const lastBookableDay = addDays(todayLocal(now), rules.maxAdvanceDays);

  const slots = [];
  for (let m = window.openMinutes; m < window.closeMinutes; m += rules.slotMinutes) {
    const startAt = localToDate(date, minutesToTime(m));
    const endAt = addMinutes(startAt, rules.slotMinutes);
    // A booking slot may span several 15-minute lock units; any lock occupies the slot.
    let lock = null;
    for (let t = startAt.getTime(); t < endAt.getTime(); t += 15 * 60 * 1000) {
      lock = lockByTime.get(t);
      if (lock) break;
    }

    let status = 'AVAILABLE';
    let label;
    let mine = false;
    if (lock?.ownerType === 'BOOKING') {
      const booking = bookingById.get(String(lock.ownerId));
      status = booking?.status === 'PENDING_APPROVAL' ? 'PENDING' : 'BOOKED';
      mine = Boolean(booking && viewer && String(booking.user) === String(viewer._id));
    } else if (lock?.ownerType === 'BLOCK') {
      status = 'BLOCKED';
      label = blockById.get(String(lock.ownerId))?.reason;
    } else if (lock?.ownerType === 'OFFER') {
      status = 'HELD';
    } else if (resource.status === 'MAINTENANCE') {
      status = 'MAINTENANCE';
    } else if (resource.status === 'INACTIVE') {
      status = 'UNAVAILABLE';
    } else if (startAt <= now) {
      status = 'PAST';
    } else if (date > lastBookableDay) {
      status = 'OUTSIDE_WINDOW';
    }
    slots.push({
      startTime: minutesToTime(m),
      endTime: minutesToTime(Math.min(m + rules.slotMinutes, window.closeMinutes)),
      startAt,
      status,
      ...(label ? { label } : {}),
      ...(mine ? { mine } : {}),
    });
  }

  // Consecutive slots with the same status merged into readable intervals.
  const intervals = [];
  for (const slot of slots) {
    const last = intervals[intervals.length - 1];
    if (last && last.status === slot.status && last.label === slot.label && last.endTime === slot.startTime) {
      last.endTime = slot.endTime;
    } else {
      intervals.push({ startTime: slot.startTime, endTime: slot.endTime, status: slot.status, label: slot.label });
    }
  }

  return { ...base, open: true, openTime: window.open, closeTime: window.close, slots, intervals };
}
