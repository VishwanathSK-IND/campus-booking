import mongoose from 'mongoose';
import { Booking } from '../models/Booking.js';
import { Resource } from '../models/Resource.js';
import { SlotLock } from '../models/SlotLock.js';
import { WaitlistEntry } from '../models/WaitlistEntry.js';
import { emitToResource, emitToUser } from '../sockets/io.js';
import { conflict, forbidden, notFound, unprocessable } from '../utils/AppError.js';
import { clock } from '../utils/clock.js';
import { logger } from '../utils/logger.js';
import { addMinutes, formatLocal } from '../utils/time.js';
import { assertBookingLimits, assertNoUserOverlap, computePriority, validateBookingRequest } from './bookingRules.js';
import { persistBooking } from './bookingService.js';
import { notify } from './notificationService.js';
import { getPolicy } from './policyService.js';
import { assertNotRestricted, getActiveRestriction } from './restrictionService.js';
import { acquireSlotLocks, isIntervalFree, lockSlots, releaseSlotLocks } from './slotLockService.js';

/**
 * Waitlist policy
 * ---------------
 * Ordering (deterministic): priority DESC, createdAt ASC, _id ASC. Priority is
 * only non-zero on resources with facultyPriority enabled (faculty 2, student 1).
 *
 * When time is released (cancel, reject, expiry, block removal, declined or
 * expired offer) the highest-ranked WAITING entry whose *entire* requested
 * interval is free receives an OFFER: the slot is held for it with OFFER slot
 * locks for `policy.waitlist.offerMinutes`. The user accepts (→ booking,
 * subject to normal approval rules) or declines; unanswered offers expire and
 * the next entry is considered.
 *
 * Concurrency: the slot locks are the claim. Two workers promoting at the same
 * time compete for the same unique lock rows, so only one offer can exist for
 * any slot; the WAITING → OFFERED update is a compare-and-set, so an entry can
 * never be offered twice.
 */

export async function joinWaitlist(user, input) {
  const now = clock.now();
  const resource = await Resource.findById(input.resourceId);
  if (!resource) throw notFound('Resource');
  const { startAt, endAt } = validateBookingRequest({ resource, user, ...input, now });
  await assertNotRestricted(user, now);

  if (await isIntervalFree(resource._id, startAt, endAt)) {
    throw conflict('SLOT_AVAILABLE', 'This time is available — you can book it directly instead of joining the waitlist');
  }
  const ownBooking = await Booking.exists({
    user: user._id,
    resource: resource._id,
    status: { $in: ['PENDING_APPROVAL', 'CONFIRMED'] },
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  });
  if (ownBooking) throw conflict('ALREADY_BOOKED', 'You already hold a booking that overlaps this time');

  const policy = await getPolicy();
  const liveEntries = await WaitlistEntry.countDocuments({ user: user._id, status: { $in: ['WAITING', 'OFFERED'] } });
  if (liveEntries >= policy.waitlist.maxEntriesPerUser) {
    throw unprocessable('WAITLIST_LIMIT', `You can be on at most ${policy.waitlist.maxEntriesPerUser} waitlists at once`);
  }

  let entry;
  try {
    entry = await WaitlistEntry.create({
      resource: resource._id,
      user: user._id,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      startAt,
      endAt,
      purpose: input.purpose,
      priority: computePriority(resource, user),
      resourceSnapshot: { name: resource.name, location: resource.location },
    });
  } catch (error) {
    if (error?.code === 11000) throw conflict('WAITLIST_DUPLICATE', 'You are already on the waitlist for this time');
    throw error;
  }

  const position = await waitlistPosition(entry);
  await notify({
    user: user._id,
    type: 'WAITLIST_JOINED',
    title: 'Added to waitlist',
    message: `You are #${position} on the waitlist for ${resource.name} on ${entry.date} ${entry.startTime}–${entry.endTime}.`,
    resource: resource._id,
    waitlistEntry: entry._id,
  });
  // The slot may have been released between our availability check and the insert.
  await promoteWaitlistForResource(resource._id);
  return { entry: await WaitlistEntry.findById(entry._id), position };
}

/** 1-based position among WAITING entries for the same resource that overlap this entry's interval. */
export async function waitlistPosition(entry) {
  const ahead = await WaitlistEntry.countDocuments({
    resource: entry.resource,
    status: 'WAITING',
    startAt: { $lt: entry.endAt },
    endAt: { $gt: entry.startAt },
    $or: [
      { priority: { $gt: entry.priority } },
      { priority: entry.priority, createdAt: { $lt: entry.createdAt } },
      { priority: entry.priority, createdAt: entry.createdAt, _id: { $lt: entry._id } },
    ],
  });
  return ahead + 1;
}

/**
 * Offers released time to the next eligible waitlisted users of a resource.
 * Safe to call concurrently and repeatedly (idempotent): it only ever creates
 * offers for intervals that are entirely free and entries still WAITING.
 */
export async function promoteWaitlistForResource(resourceId) {
  const now = clock.now();
  const resource = await Resource.findById(resourceId);
  if (!resource || resource.status !== 'ACTIVE') return [];
  const policy = await getPolicy();

  const candidates = await WaitlistEntry.find({ resource: resource._id, status: 'WAITING', startAt: { $gt: now } })
    .sort({ priority: -1, createdAt: 1, _id: 1 })
    .limit(100);

  const offered = [];
  for (const entry of candidates) {
    if (!(await isIntervalFree(resource._id, entry.startAt, entry.endAt))) continue;
    if (await getActiveRestriction(entry.user, now)) continue;

    const offerId = new mongoose.Types.ObjectId();
    try {
      await acquireSlotLocks({ resourceId: resource._id, startAt: entry.startAt, endAt: entry.endAt, ownerType: 'OFFER', ownerId: offerId });
    } catch (error) {
      if (error.code === 'BOOKING_CONFLICT') continue; // another worker or booking took (part of) it first
      throw error;
    }

    const offerExpiresAt = addMinutes(now, policy.waitlist.offerMinutes);
    const claimed = await WaitlistEntry.findOneAndUpdate(
      { _id: entry._id, status: 'WAITING' },
      { $set: { status: 'OFFERED', offerId, offeredAt: now, offerExpiresAt } },
      { new: true },
    );
    if (!claimed) {
      await releaseSlotLocks(offerId);
      continue;
    }

    offered.push(claimed);
    await notify({
      user: claimed.user,
      type: 'WAITLIST_OFFER',
      title: 'A waitlisted slot is available',
      message: `${resource.name} on ${claimed.date} ${claimed.startTime}–${claimed.endTime} is being held for you until ${formatLocal(offerExpiresAt, 'HH:mm')}. Accept it from My Bookings → Waitlist.`,
      resource: resource._id,
      waitlistEntry: claimed._id,
    });
    emitToUser(claimed.user, 'waitlist.promoted', { entryId: String(claimed._id), resourceId: String(resource._id) });
    emitToResource(resource._id, 'availability.updated', { resourceId: String(resource._id), date: claimed.date });
  }
  return offered;
}

export async function acceptOffer(entryId, user) {
  const entry = await WaitlistEntry.findById(entryId);
  if (!entry) throw notFound('Waitlist entry');
  if (String(entry.user) !== String(user._id)) throw forbidden('This waitlist entry belongs to another user');
  if (entry.status !== 'OFFERED') throw conflict('INVALID_WAITLIST_STATE', `This waitlist entry is ${entry.status.toLowerCase()}, not offered`);
  const now = clock.now();
  if (entry.offerExpiresAt <= now) throw conflict('OFFER_EXPIRED', 'This offer has expired');

  const resource = await Resource.findById(entry.resource);
  if (!resource) throw notFound('Resource');
  const data = { date: entry.date, startTime: entry.startTime, endTime: entry.endTime, purpose: entry.purpose };
  const timing = validateBookingRequest({ resource, user, ...data, now });
  await assertNotRestricted(user, now);
  const policy = await getPolicy();
  await assertBookingLimits({ user, resource, policy, now, pending: true });
  await assertNoUserOverlap(user._id, timing.startAt, timing.endAt);

  const expectedLocks = lockSlots(entry.startAt, entry.endAt).length;
  const booking = await persistBooking({
    user,
    resource,
    policy,
    data,
    timing,
    now,
    source: 'WAITLIST',
    waitlistEntry: entry._id,
    // Claim the entry (OFFERED → ACCEPTED, compare-and-set) and hand its held locks to the booking.
    claimLocks: async (bookingId, session) => {
      const claimed = await WaitlistEntry.findOneAndUpdate(
        { _id: entry._id, status: 'OFFERED', offerId: entry.offerId, offerExpiresAt: { $gt: now } },
        { $set: { status: 'ACCEPTED', booking: bookingId, respondedAt: now } },
        { new: true, session },
      );
      if (!claimed) throw conflict('OFFER_EXPIRED', 'This offer is no longer available');
      const moved = await SlotLock.updateMany(
        { ownerType: 'OFFER', ownerId: entry.offerId },
        { $set: { ownerType: 'BOOKING', ownerId: bookingId } },
        { session },
      );
      if (moved.modifiedCount !== expectedLocks) throw conflict('OFFER_EXPIRED', 'The held slot is no longer available');
    },
    compensate: async (bookingId) => {
      await SlotLock.updateMany({ ownerType: 'BOOKING', ownerId: bookingId }, { $set: { ownerType: 'OFFER', ownerId: entry.offerId } });
      await WaitlistEntry.updateOne(
        { _id: entry._id, status: 'ACCEPTED', booking: bookingId },
        { $set: { status: 'OFFERED' }, $unset: { booking: 1, respondedAt: 1 } },
      );
    },
  });
  return { entry: await WaitlistEntry.findById(entry._id), booking };
}

async function closeOffer(entry, toStatus, extra = {}) {
  const closed = await WaitlistEntry.findOneAndUpdate(
    { _id: entry._id, status: 'OFFERED', offerId: entry.offerId },
    { $set: { status: toStatus, ...extra } },
    { new: true },
  );
  if (!closed) return null;
  await releaseSlotLocks(entry.offerId);
  emitToResource(entry.resource, 'availability.updated', { resourceId: String(entry.resource), date: entry.date });
  await promoteWaitlistForResource(entry.resource);
  return closed;
}

export async function declineOffer(entryId, user) {
  const entry = await WaitlistEntry.findById(entryId);
  if (!entry) throw notFound('Waitlist entry');
  if (String(entry.user) !== String(user._id)) throw forbidden('This waitlist entry belongs to another user');
  if (entry.status !== 'OFFERED') throw conflict('INVALID_WAITLIST_STATE', 'Only offered entries can be declined');
  const closed = await closeOffer(entry, 'DECLINED', { respondedAt: clock.now() });
  if (!closed) throw conflict('INVALID_WAITLIST_STATE', 'This offer is no longer active');
  return closed;
}

export async function leaveWaitlist(entryId, user) {
  const entry = await WaitlistEntry.findById(entryId);
  if (!entry) throw notFound('Waitlist entry');
  if (String(entry.user) !== String(user._id)) throw forbidden('This waitlist entry belongs to another user');
  if (entry.status === 'OFFERED') return declineOffer(entryId, user);
  const left = await WaitlistEntry.findOneAndUpdate({ _id: entry._id, status: 'WAITING' }, { $set: { status: 'CANCELLED' } }, { new: true });
  if (!left) throw conflict('INVALID_WAITLIST_STATE', `This entry is already ${entry.status.toLowerCase()}`);
  return left;
}

export async function listMyWaitlist(user, { status, page, limit }) {
  const filter = { user: user._id };
  if (status === 'active') filter.status = { $in: ['WAITING', 'OFFERED'] };
  else if (status) filter.status = status;
  const [items, total] = await Promise.all([
    WaitlistEntry.find(filter)
      .sort({ status: -1, startAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    WaitlistEntry.countDocuments(filter),
  ]);
  for (const item of items) {
    if (item.status === 'WAITING') item.position = await waitlistPosition(item);
  }
  return { items, total };
}

/** Background job: expire unanswered offers (and move on to the next user) and stale WAITING entries. */
export async function expireWaitlist(now = clock.now()) {
  let expiredOffers = 0;
  const offers = await WaitlistEntry.find({ status: 'OFFERED', offerExpiresAt: { $lte: now } }).limit(200);
  for (const entry of offers) {
    try {
      const closed = await closeOffer(entry, 'EXPIRED');
      if (!closed) continue;
      expiredOffers += 1;
      await notify({
        user: entry.user,
        type: 'WAITLIST_OFFER_EXPIRED',
        title: 'Waitlist offer expired',
        message: `The held slot for ${entry.resourceSnapshot?.name} on ${entry.date} ${entry.startTime}–${entry.endTime} was not accepted in time and has been offered to the next person.`,
        resource: entry.resource,
        waitlistEntry: entry._id,
      });
    } catch (error) {
      logger.error('Failed to expire waitlist offer', entry._id, error);
    }
  }
  const stale = await WaitlistEntry.updateMany({ status: 'WAITING', startAt: { $lte: now } }, { $set: { status: 'EXPIRED' } });
  return { expiredOffers, expiredWaiting: stale.modifiedCount };
}

/** Background job: recovery sweep in case a promotion was missed (e.g. process restart). */
export async function promoteAllWaitlists() {
  const resourceIds = await WaitlistEntry.distinct('resource', { status: 'WAITING', startAt: { $gt: clock.now() } });
  let offers = 0;
  for (const id of resourceIds) {
    try {
      offers += (await promoteWaitlistForResource(id)).length;
    } catch (error) {
      logger.error('Waitlist promotion failed for resource', id, error);
    }
  }
  return { offers };
}

