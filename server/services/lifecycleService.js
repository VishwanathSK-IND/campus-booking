import { Booking } from '../models/Booking.js';
import { NoShowRecord } from '../models/NoShowRecord.js';
import { Restriction } from '../models/Restriction.js';
import { SlotLock } from '../models/SlotLock.js';
import { WaitlistEntry } from '../models/WaitlistEntry.js';
import { emitBookingChange } from '../sockets/io.js';
import { clock } from '../utils/clock.js';
import { logger } from '../utils/logger.js';
import { addMinutes, formatLocal } from '../utils/time.js';
import { runInTransaction } from '../utils/transaction.js';
import { audit } from './auditService.js';
import { transitionBooking } from './bookingTransitions.js';
import { notify, notifyOnce } from './notificationService.js';
import { getPolicy, noShowTierFor } from './policyService.js';
import { releaseSlotLocks } from './slotLockService.js';

/**
 * Time-driven booking lifecycle, executed by the scheduler (jobs/scheduler.js).
 * Every step is idempotent: state changes are compare-and-set transitions, so
 * running a job twice (or on two servers) cannot double-process a booking,
 * double-penalise a user or send duplicate reminders.
 */

const BATCH = 200;

/**
 * CONFIRMED bookings whose check-in window has closed without a check-in
 * become NO_SHOW. Unit of work: mark NO_SHOW → release remaining time →
 * NoShowRecord → escalating penalty (warning / temporary restriction) →
 * notifications → audit.
 */
export async function processNoShow(bookingId, now = clock.now()) {
  const policy = await getPolicy();
  return runInTransaction(async (ctx) => {
    const { session } = ctx;
    const booking = await transitionBooking(
      bookingId,
      'CONFIRMED',
      'NO_SHOW',
      { set: { noShowAt: now, checkInStatus: 'MISSED' }, note: 'No check-in before the grace period ended' },
      session,
    );
    if (!booking) return null; // already processed or checked in meanwhile

    await releaseSlotLocks(booking._id, session);

    const since = addMinutes(now, -policy.noShow.lookbackDays * 24 * 60);
    const previous = await NoShowRecord.countDocuments({ user: booking.user, occurredAt: { $gte: since }, waived: false }, { session });
    const count = previous + 1;
    const tier = noShowTierFor(policy, count);

    let restriction = null;
    if (tier.action === 'RESTRICTION' && tier.restrictionDays > 0) {
      [restriction] = await Restriction.create(
        [
          {
            user: booking.user,
            source: 'NO_SHOW',
            reason: `${count} no-show(s) in the last ${policy.noShow.lookbackDays} days`,
            startsAt: now,
            endsAt: addMinutes(now, tier.restrictionDays * 24 * 60),
          },
        ],
        { session },
      );
    }
    const [record] = await NoShowRecord.create(
      [
        {
          user: booking.user,
          booking: booking._id,
          resource: booking.resource,
          occurredAt: now,
          countInWindow: count,
          penaltyApplied: restriction ? 'RESTRICTION' : 'WARNING',
          restriction: restriction?._id,
        },
      ],
      { session },
    );
    if (restriction) {
      await Restriction.updateOne({ _id: restriction._id }, { noShowRecord: record._id }, { session });
    }

    await notify(
      {
        user: booking.user,
        type: 'NO_SHOW',
        title: 'Missed booking recorded',
        message: `You did not check in to ${booking.resourceSnapshot.name} on ${booking.date} ${booking.startTime}–${booking.endTime}. This is no-show #${count} in the last ${policy.noShow.lookbackDays} days.`,
        booking: booking._id,
        resource: booking.resource,
      },
      ctx,
    );
    if (restriction) {
      await notify(
        {
          user: booking.user,
          type: 'RESTRICTION',
          title: 'Booking privileges restricted',
          message: `Because of repeated no-shows you cannot make new bookings until ${formatLocal(restriction.endsAt)}.`,
          booking: booking._id,
        },
        ctx,
      );
    }
    await audit(
      {
        actor: null,
        action: restriction ? 'NO_SHOW_RESTRICTION' : 'NO_SHOW_RECORDED',
        entityType: 'Booking',
        entityId: booking._id,
        summary: `No-show for ${booking.code} by ${booking.userSnapshot.email}${restriction ? ` — restricted ${tier.restrictionDays} day(s)` : ' — warning'}`,
        details: { count, tier },
      },
      ctx,
    );
    ctx.afterCommit(() => emitBookingChange('booking.noShow', booking));
    return { booking, record, restriction };
  });
}

export async function markNoShows(now = clock.now()) {
  const due = await Booking.find({ status: 'CONFIRMED', checkInClosesAt: { $lt: now } }).select('_id').limit(BATCH);
  let processed = 0;
  for (const { _id } of due) {
    try {
      if (await processNoShow(_id, now)) processed += 1;
    } catch (error) {
      // Duplicate NoShowRecord (another worker won) or transient failure: next run retries safely.
      if (error?.code !== 11000) logger.error('No-show processing failed', _id, error);
    }
  }
  return { processed };
}

export async function completeBookings(now = clock.now()) {
  const due = await Booking.find({ status: 'CHECKED_IN', endAt: { $lte: now } }).select('_id').limit(BATCH);
  let completed = 0;
  for (const { _id } of due) {
    const booking = await transitionBooking(_id, 'CHECKED_IN', 'COMPLETED', { set: { completedAt: now }, note: 'Booking time ended' });
    if (booking) {
      completed += 1;
      emitBookingChange('booking.completed', booking);
    }
  }
  return { completed };
}

/** Pending requests nobody reviewed before the start time expire and release the slot. */
export async function expirePendingApprovals(now = clock.now()) {
  const due = await Booking.find({ status: 'PENDING_APPROVAL', startAt: { $lte: now } }).select('_id').limit(BATCH);
  let expired = 0;
  for (const { _id } of due) {
    const booking = await transitionBooking(_id, 'PENDING_APPROVAL', 'EXPIRED', {
      set: { expiredAt: now, approvalStatus: 'REJECTED' },
      note: 'Not reviewed before the start time',
    });
    if (!booking) continue;
    expired += 1;
    await releaseSlotLocks(booking._id);
    await notifyOnce({
      user: booking.user,
      type: 'BOOKING_EXPIRED',
      title: 'Booking request expired',
      message: `Your request for ${booking.resourceSnapshot.name} on ${booking.date} ${booking.startTime}–${booking.endTime} was not reviewed in time.`,
      booking: booking._id,
      resource: booking.resource,
      dedupeKey: `expired:${booking._id}`,
    });
    emitBookingChange('booking.expired', booking);
  }
  return { expired };
}

/**
 * Reminder before the booking and a check-in reminder shortly before start.
 * The sent-at flag is claimed with a compare-and-set and the notification has
 * a dedupe key, so a reminder is sent at most once.
 */
export async function sendReminders(now = clock.now()) {
  const policy = await getPolicy();
  if (!policy.reminders.enabled) return { reminders: 0, checkInReminders: 0 };
  let reminders = 0;
  let checkInReminders = 0;

  const upcoming = await Booking.find({
    status: 'CONFIRMED',
    reminderSentAt: null,
    startAt: { $gt: now, $lte: addMinutes(now, policy.reminders.leadMinutes) },
  }).limit(BATCH);
  for (const booking of upcoming) {
    const claimed = await Booking.updateOne({ _id: booking._id, reminderSentAt: null }, { reminderSentAt: now });
    if (!claimed.modifiedCount) continue;
    const sent = await notifyOnce({
      user: booking.user,
      type: 'BOOKING_REMINDER',
      title: 'Upcoming booking',
      message: `Reminder: ${booking.resourceSnapshot.name} (${booking.resourceSnapshot.location}) on ${booking.date} ${booking.startTime}–${booking.endTime}.`,
      booking: booking._id,
      resource: booking.resource,
      dedupeKey: `reminder:${booking._id}`,
    });
    if (sent) reminders += 1;
  }

  const startingSoon = await Booking.find({
    status: 'CONFIRMED',
    checkInReminderSentAt: null,
    startAt: { $gt: now, $lte: addMinutes(now, policy.reminders.checkInLeadMinutes) },
  }).limit(BATCH);
  for (const booking of startingSoon) {
    const claimed = await Booking.updateOne({ _id: booking._id, checkInReminderSentAt: null }, { checkInReminderSentAt: now });
    if (!claimed.modifiedCount) continue;
    const sent = await notifyOnce({
      user: booking.user,
      type: 'CHECK_IN_REMINDER',
      title: 'Remember to check in',
      message: `${booking.resourceSnapshot.name} starts at ${booking.startTime}. Scan the venue QR code between ${formatLocal(booking.checkInOpensAt, 'HH:mm')} and ${formatLocal(booking.checkInClosesAt, 'HH:mm')} or the booking will be marked as a no-show.`,
      booking: booking._id,
      resource: booking.resource,
      dedupeKey: `checkin-reminder:${booking._id}`,
    });
    if (sent) checkInReminders += 1;
  }
  return { reminders, checkInReminders };
}

/**
 * Removes locks left behind by a crash between steps on a standalone server
 * (no transactions). Only locks older than a few minutes are considered so
 * in-flight requests are never affected.
 */
export async function cleanupOrphanLocks(now = clock.now()) {
  const cutoff = addMinutes(now, -5);
  let removed = 0;

  const bookingOwners = await SlotLock.distinct('ownerId', { ownerType: 'BOOKING', createdAt: { $lt: cutoff } });
  if (bookingOwners.length) {
    const live = await Booking.find({ _id: { $in: bookingOwners }, status: { $in: ['PENDING_APPROVAL', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED'] } }).distinct('_id');
    const liveSet = new Set(live.map(String));
    const dead = bookingOwners.filter((id) => !liveSet.has(String(id)));
    if (dead.length) removed += (await SlotLock.deleteMany({ ownerType: 'BOOKING', ownerId: { $in: dead }, createdAt: { $lt: cutoff } })).deletedCount;
  }

  const offerOwners = await SlotLock.distinct('ownerId', { ownerType: 'OFFER', createdAt: { $lt: cutoff } });
  if (offerOwners.length) {
    const live = await WaitlistEntry.find({ offerId: { $in: offerOwners }, status: 'OFFERED' }).distinct('offerId');
    const liveSet = new Set(live.map(String));
    const dead = offerOwners.filter((id) => !liveSet.has(String(id)));
    if (dead.length) removed += (await SlotLock.deleteMany({ ownerType: 'OFFER', ownerId: { $in: dead }, createdAt: { $lt: cutoff } })).deletedCount;
  }
  return { removedLocks: removed };
}
