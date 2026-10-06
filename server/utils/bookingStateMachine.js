/**
 * Explicit booking lifecycle. Every status change in the system goes through
 * services/bookingTransitions.js, which only performs transitions listed here
 * and only if the booking is still in the expected "from" state (atomic
 * compare-and-set), so retries and races cannot apply a transition twice.
 *
 *   PENDING_APPROVAL ──approve──▶ CONFIRMED ──check-in──▶ CHECKED_IN ──end──▶ COMPLETED
 *        │  │  └──reject──▶ REJECTED      │  └──grace passed──▶ NO_SHOW
 *        │  └──start passed──▶ EXPIRED    └──cancel──▶ CANCELLED
 *        └──cancel──▶ CANCELLED
 */
export const BOOKING_STATUSES = [
  'PENDING_APPROVAL',
  'CONFIRMED',
  'CHECKED_IN',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'NO_SHOW',
  'EXPIRED',
];

export const TRANSITIONS = {
  PENDING_APPROVAL: ['CONFIRMED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [],
  NO_SHOW: [],
  EXPIRED: [],
};

/** Statuses that occupy the resource and count towards a user's active bookings. */
export const ACTIVE_STATUSES = ['PENDING_APPROVAL', 'CONFIRMED', 'CHECKED_IN'];

/** Statuses whose slot locks are released (time becomes bookable again). */
export const RELEASING_STATUSES = ['CANCELLED', 'REJECTED', 'EXPIRED', 'NO_SHOW'];

export function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(to));
}
