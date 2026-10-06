import { Booking } from '../models/Booking.js';
import { conflict } from '../utils/AppError.js';
import { canTransition } from '../utils/bookingStateMachine.js';
import { clock } from '../utils/clock.js';

/**
 * Atomic compare-and-set status change. The update only matches while the
 * booking is still in `from`, so of two racing actors (approve vs cancel, a job
 * running twice) exactly one succeeds. Returns null if the booking moved on.
 */
export async function transitionBooking(bookingId, from, to, { set = {}, by = null, note } = {}, session = null) {
  if (!canTransition(from, to)) throw new Error(`Illegal booking transition ${from} → ${to}`);
  return Booking.findOneAndUpdate(
    { _id: bookingId, status: from },
    {
      $set: { status: to, ...set },
      $push: { statusHistory: { from, to, at: clock.now(), by, note } },
    },
    { new: true, session },
  );
}

export async function transitionOrConflict(bookingId, from, to, options, session) {
  const updated = await transitionBooking(bookingId, from, to, options, session);
  if (!updated) {
    throw conflict('INVALID_STATE_TRANSITION', 'This booking was changed by someone else. Refresh and try again.');
  }
  return updated;
}
