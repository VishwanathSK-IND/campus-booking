import { SlotLock } from '../models/SlotLock.js';
import { conflict } from '../utils/AppError.js';
import { slotStartsBetween } from '../utils/time.js';

/**
 * Lock granularity is fixed and independent of a resource's booking slot size,
 * so changing a resource from 30- to 60-minute slots can never let two
 * overlapping reservations produce disjoint lock sets. Booking boundaries are
 * always multiples of this value.
 */
export const LOCK_MINUTES = 15;

export function lockSlots(startAt, endAt) {
  return slotStartsBetween(startAt, endAt, LOCK_MINUTES);
}

export function isDuplicateKeyError(error) {
  return error?.code === 11000 || Boolean(error?.writeErrors?.some?.((e) => e.code === 11000 || e.err?.code === 11000));
}

/**
 * Atomically claims every 15-minute unit of [startAt, endAt) for an owner.
 * Two requests for overlapping intervals always share at least one unit, and
 * the unique (resource, slotStart) index guarantees only one insert of that
 * unit can succeed — this holds across processes and without transactions.
 */
export async function acquireSlotLocks({ resourceId, startAt, endAt, ownerType, ownerId }, session = null) {
  const docs = lockSlots(startAt, endAt).map((slotStart) => ({
    resource: resourceId,
    slotStart,
    ownerType,
    ownerId,
  }));
  try {
    await SlotLock.insertMany(docs, { session, ordered: true });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      // Without a transaction, remove the partial set this owner managed to insert.
      if (!session) await SlotLock.deleteMany({ ownerId });
      throw conflict('BOOKING_CONFLICT', 'The selected time overlaps with an existing booking or blocked period');
    }
    throw error;
  }
  return docs.length;
}

export async function releaseSlotLocks(ownerId, session = null) {
  const result = await SlotLock.deleteMany({ ownerId }, { session });
  return result.deletedCount;
}

export async function isIntervalFree(resourceId, startAt, endAt) {
  const lock = await SlotLock.exists({ resource: resourceId, slotStart: { $gte: startAt, $lt: endAt } });
  return !lock;
}

export async function locksInInterval(resourceId, startAt, endAt) {
  return SlotLock.find({ resource: resourceId, slotStart: { $gte: startAt, $lt: endAt } }).lean();
}
