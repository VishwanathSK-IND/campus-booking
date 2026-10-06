import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Booking } from '../models/Booking.js';
import { Resource } from '../models/Resource.js';
import { SlotLock } from '../models/SlotLock.js';
import { User } from '../models/User.js';
import { emitBookingChange, emitToStaff } from '../sockets/io.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../utils/AppError.js';
import { ACTIVE_STATUSES } from '../utils/bookingStateMachine.js';
import { clock } from '../utils/clock.js';
import { formatLocal } from '../utils/time.js';
import { runInTransaction } from '../utils/transaction.js';
import { audit } from './auditService.js';
import {
  assertBookingLimits,
  assertNoUserOverlap,
  computePriority,
  policySnapshot,
  requiresApproval,
  validateBookingRequest,
} from './bookingRules.js';
import { transitionBooking, transitionOrConflict } from './bookingTransitions.js';
import { withIdempotency } from './idempotencyService.js';
import { approverRecipients, notify } from './notificationService.js';
import { getPolicy } from './policyService.js';
import { assertNotRestricted, getActiveRestriction } from './restrictionService.js';
import { acquireSlotLocks, lockSlots, releaseSlotLocks } from './slotLockService.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(date) {
  const bytes = crypto.randomBytes(6);
  const suffix = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `CB-${date.replace(/-/g, '')}-${suffix}`;
}

function timeRange(booking) {
  return `${booking.date} ${booking.startTime}–${booking.endTime}`;
}

async function promoteAfterRelease(resourceId) {
  const { promoteWaitlistForResource } = await import('./waitlistService.js');
  await promoteWaitlistForResource(resourceId);
}

/**
 * Inserts a booking and everything that must accompany it as one unit:
 *   1. touch the user document (serialises same-user bookings under transactions)
 *   2. claim the slot locks (the conflict guard — fails with 409 on overlap)
 *   3. insert the booking with resource/user/policy snapshots
 *   4. re-check per-user limits and overlap now that the booking is visible
 *   5. notifications (+ approver notifications when approval is required)
 * Socket events are emitted only after the unit commits.
 */
export async function persistBooking({ user, resource, policy, data, timing, now, claimLocks, source = 'DIRECT', waitlistEntry, compensate }) {
  const bookingId = new mongoose.Types.ObjectId();
  const needsApproval = requiresApproval(resource, user);
  const status = needsApproval ? 'PENDING_APPROVAL' : 'CONFIRMED';
  const doc = {
    _id: bookingId,
    code: generateCode(data.date),
    resource: resource._id,
    user: user._id,
    date: data.date,
    startTime: data.startTime,
    endTime: data.endTime,
    startAt: timing.startAt,
    endAt: timing.endAt,
    durationMinutes: timing.durationMinutes,
    purpose: data.purpose,
    status,
    approvalStatus: needsApproval ? 'PENDING' : 'NOT_REQUIRED',
    priority: computePriority(resource, user),
    source,
    waitlistEntry,
    resourceSnapshot: { name: resource.name, location: resource.location, category: resource.category },
    userSnapshot: { name: user.name, email: user.email, role: user.role },
    ...policySnapshot(resource, timing.startAt, timing.endAt),
    statusHistory: [
      { from: null, to: status, at: now, by: user._id, note: source === 'WAITLIST' ? 'Accepted waitlist offer' : 'Booking requested' },
    ],
  };
  const approvers = needsApproval ? (await approverRecipients(resource)).filter((id) => String(id) !== String(user._id)) : [];

  return runInTransaction(
    async (ctx) => {
      const { session } = ctx;
      await User.updateOne({ _id: user._id }, { $set: { lastBookingAttemptAt: now } }, { session });
      await claimLocks(bookingId, session);
      const [booking] = await Booking.create([doc], { session });

      await assertBookingLimits({ user, resource, policy, now, session, pending: false });
      await assertNoUserOverlap(user._id, timing.startAt, timing.endAt, { session, excluding: bookingId });

      await notify(
        needsApproval
          ? {
              user: user._id,
              type: 'BOOKING_PENDING',
              title: 'Booking request submitted for approval',
              message: `${resource.name} on ${timeRange(booking)} is awaiting approval (${booking.code}).`,
              booking: booking._id,
              resource: resource._id,
            }
          : {
              user: user._id,
              type: 'BOOKING_CREATED',
              title: 'Booking confirmed',
              message: `${resource.name} is booked for ${timeRange(booking)} (${booking.code}).`,
              booking: booking._id,
              resource: resource._id,
            },
        ctx,
      );
      for (const approverId of approvers) {
        await notify(
          {
            user: approverId,
            type: 'APPROVAL_REQUESTED',
            title: 'Booking awaiting your approval',
            message: `${user.name} requested ${resource.name} on ${timeRange(booking)}. Purpose: ${booking.purpose}`,
            booking: booking._id,
            resource: resource._id,
          },
          ctx,
        );
      }
      ctx.afterCommit(() => {
        emitBookingChange('booking.created', booking);
        if (needsApproval) emitToStaff('approval.requested', { bookingId: String(booking._id) });
      });
      return booking;
    },
    {
      compensate: async () => {
        await Booking.deleteOne({ _id: bookingId });
        await releaseSlotLocks(bookingId);
        await compensate?.(bookingId);
      },
    },
  );
}

export async function createBooking(user, input, idempotencyKey) {
  return withIdempotency(
    user,
    'booking.create',
    idempotencyKey,
    async () => {
      const now = clock.now();
      const resource = await Resource.findById(input.resourceId);
      if (!resource) throw notFound('Resource');

      const timing = validateBookingRequest({ resource, user, ...input, now });
      await assertNotRestricted(user, now);
      const policy = await getPolicy();
      // Fast-fail pre-checks with friendly messages; the authoritative checks run inside persistBooking.
      await assertBookingLimits({ user, resource, policy, now, pending: true });
      await assertNoUserOverlap(user._id, timing.startAt, timing.endAt);

      return persistBooking({
        user,
        resource,
        policy,
        data: input,
        timing,
        now,
        claimLocks: (bookingId, session) =>
          acquireSlotLocks({ resourceId: resource._id, ...timing, ownerType: 'BOOKING', ownerId: bookingId }, session),
      });
    },
    (id) => Booking.findById(id),
  );
}

export function canReview(user, booking, resource) {
  if (String(booking.user?._id || booking.user) === String(user._id)) return false;
  if (user.role === 'ADMIN') return true;
  return user.role === 'FACULTY' && (resource?.approvers || []).some((a) => String(a._id || a) === String(user._id));
}

function assertCanReview(reviewer, booking, resource) {
  if (String(booking.user) === String(reviewer._id)) {
    throw forbidden('You cannot review your own booking', 'SELF_REVIEW');
  }
  if (!canReview(reviewer, booking, resource)) {
    throw forbidden('You are not an approver for this resource', 'NOT_APPROVER');
  }
}

async function loadForReview(bookingId, reviewer) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw notFound('Booking');
  const resource = await Resource.findById(booking.resource);
  assertCanReview(reviewer, booking, resource);
  if (booking.status !== 'PENDING_APPROVAL') {
    throw conflict('INVALID_BOOKING_STATE', `Only pending bookings can be reviewed (current status: ${booking.status})`);
  }
  return { booking, resource };
}

/**
 * Approval re-validates everything that may have changed since the request:
 * still pending, not started, resource still active, slot still held by this
 * booking, requester not restricted. The status change itself is atomic.
 */
export async function approveBooking(bookingId, reviewer, { note } = {}) {
  const { booking, resource } = await loadForReview(bookingId, reviewer);
  const now = clock.now();
  if (booking.startAt <= now) {
    throw conflict('APPROVAL_EXPIRED', 'This booking request has already started and can no longer be approved');
  }
  if (!resource || resource.status !== 'ACTIVE') {
    throw conflict('RESOURCE_UNAVAILABLE', `Cannot approve: ${booking.resourceSnapshot.name} is ${resource?.status?.toLowerCase() ?? 'no longer available'}`);
  }
  const held = await SlotLock.countDocuments({ ownerId: booking._id });
  if (held !== lockSlots(booking.startAt, booking.endAt).length) {
    throw conflict('BOOKING_CONFLICT', 'The requested time is no longer reserved for this booking');
  }
  if (await getActiveRestriction(booking.user, now)) {
    throw conflict('USER_RESTRICTED', 'The requester currently has an active booking restriction');
  }

  return runInTransaction(async (ctx) => {
    const updated = await transitionOrConflict(
      booking._id,
      'PENDING_APPROVAL',
      'CONFIRMED',
      { set: { approvalStatus: 'APPROVED', approvedBy: reviewer._id, approvedAt: now, reviewNote: note }, by: reviewer._id, note },
      ctx.session,
    );
    await notify(
      {
        user: booking.user,
        type: 'BOOKING_APPROVED',
        title: 'Booking approved',
        message: `${booking.resourceSnapshot.name} on ${timeRange(booking)} was approved by ${reviewer.name}.${note ? ` Note: ${note}` : ''}`,
        booking: booking._id,
        resource: booking.resource,
      },
      ctx,
    );
    await audit(
      {
        actor: reviewer,
        action: 'BOOKING_APPROVED',
        entityType: 'Booking',
        entityId: booking._id,
        summary: `Approved ${booking.code} (${booking.resourceSnapshot.name}, ${timeRange(booking)})`,
        details: { note },
      },
      ctx,
    );
    ctx.afterCommit(() => emitBookingChange('booking.approved', updated));
    return updated;
  });
}

export async function rejectBooking(bookingId, reviewer, { reason }) {
  const { booking } = await loadForReview(bookingId, reviewer);
  const now = clock.now();
  const updated = await runInTransaction(async (ctx) => {
    const result = await transitionOrConflict(
      booking._id,
      'PENDING_APPROVAL',
      'REJECTED',
      { set: { approvalStatus: 'REJECTED', rejectedBy: reviewer._id, rejectedAt: now, rejectionReason: reason }, by: reviewer._id, note: reason },
      ctx.session,
    );
    await releaseSlotLocks(booking._id, ctx.session);
    await notify(
      {
        user: booking.user,
        type: 'BOOKING_REJECTED',
        title: 'Booking request rejected',
        message: `${booking.resourceSnapshot.name} on ${timeRange(booking)} was rejected. Reason: ${reason}`,
        booking: booking._id,
        resource: booking.resource,
      },
      ctx,
    );
    await audit(
      {
        actor: reviewer,
        action: 'BOOKING_REJECTED',
        entityType: 'Booking',
        entityId: booking._id,
        summary: `Rejected ${booking.code} (${booking.resourceSnapshot.name}, ${timeRange(booking)})`,
        details: { reason },
      },
      ctx,
    );
    ctx.afterCommit(async () => {
      emitBookingChange('booking.rejected', result);
      await promoteAfterRelease(booking.resource);
    });
    return result;
  });
  return updated;
}

/**
 * Owners may cancel pending bookings any time before start and confirmed
 * bookings until the cancellation deadline. Admins may cancel any pending or
 * confirmed booking before it ends, with a reason. Bookings are never deleted.
 */
export async function cancelBooking(bookingId, actor, { reason, system = false } = {}) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw notFound('Booking');
  const isOwner = String(booking.user) === String(actor._id);
  const isAdmin = actor.role === 'ADMIN';
  if (!isOwner && !isAdmin) throw forbidden('You can only cancel your own bookings', 'NOT_BOOKING_OWNER');
  if (!['PENDING_APPROVAL', 'CONFIRMED'].includes(booking.status)) {
    throw conflict('INVALID_BOOKING_STATE', `A ${booking.status.toLowerCase().replace('_', ' ')} booking cannot be cancelled`);
  }

  const now = clock.now();
  if (isAdmin && !isOwner) {
    if (!reason) throw badRequest('REASON_REQUIRED', 'A reason is required when cancelling another user’s booking');
    if (now >= booking.endAt) throw conflict('BOOKING_ENDED', 'This booking has already ended');
  } else {
    if (now >= booking.startAt) throw conflict('BOOKING_ALREADY_STARTED', 'Bookings cannot be cancelled after they start');
    if (booking.status === 'CONFIRMED' && now > booking.cancellationDeadlineAt && !isAdmin) {
      throw unprocessable(
        'CANCELLATION_DEADLINE_PASSED',
        `The cancellation deadline (${formatLocal(booking.cancellationDeadlineAt)}) has passed. Please contact an administrator.`,
      );
    }
  }

  return runInTransaction(async (ctx) => {
    const updated = await transitionOrConflict(
      booking._id,
      booking.status,
      'CANCELLED',
      { set: { cancelledBy: actor._id, cancelledAt: now, cancellationReason: reason }, by: actor._id, note: reason },
      ctx.session,
    );
    await releaseSlotLocks(booking._id, ctx.session);
    await notify(
      {
        user: booking.user,
        type: 'BOOKING_CANCELLED',
        title: 'Booking cancelled',
        message: isOwner
          ? `You cancelled ${booking.resourceSnapshot.name} on ${timeRange(booking)}.`
          : `${booking.resourceSnapshot.name} on ${timeRange(booking)} was cancelled by an administrator. Reason: ${reason}`,
        booking: booking._id,
        resource: booking.resource,
      },
      ctx,
    );
    if (isAdmin && (!isOwner || system)) {
      await audit(
        {
          actor,
          action: 'BOOKING_CANCELLED',
          entityType: 'Booking',
          entityId: booking._id,
          summary: `Cancelled ${booking.code} (${booking.resourceSnapshot.name}, ${timeRange(booking)})`,
          details: { reason, previousStatus: booking.status },
        },
        ctx,
      );
    }
    ctx.afterCommit(async () => {
      emitBookingChange('booking.cancelled', updated);
      await promoteAfterRelease(booking.resource);
    });
    return updated;
  });
}

function verifyCheckInToken(token) {
  try {
    const payload = jwt.verify(token, env.QR_TOKEN_SECRET);
    if (payload.typ !== 'checkin' || !payload.rid) throw new Error('wrong token type');
    return payload;
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      throw badRequest('QR_TOKEN_EXPIRED', 'This check-in code has expired. Scan the code currently shown at the venue.');
    }
    throw badRequest('QR_TOKEN_INVALID', 'This is not a valid check-in code');
  }
}

/**
 * Venue QR check-in. The token proves the user is looking at the rotating code
 * displayed at the resource right now; the server then checks ownership,
 * resource match, state and the check-in window. QR contents alone are never trusted.
 */
export async function checkIn(bookingId, user, token) {
  const payload = verifyCheckInToken(token);
  const booking = await Booking.findById(bookingId);
  if (!booking) throw notFound('Booking');
  if (String(booking.user) !== String(user._id)) throw forbidden('You can only check in to your own bookings', 'NOT_BOOKING_OWNER');
  if (payload.rid !== String(booking.resource)) {
    throw badRequest('QR_RESOURCE_MISMATCH', `This code belongs to a different venue. Scan the code at ${booking.resourceSnapshot.name}.`);
  }
  if (booking.status === 'CHECKED_IN') throw conflict('ALREADY_CHECKED_IN', 'You have already checked in to this booking');
  if (booking.status !== 'CONFIRMED') {
    throw conflict('INVALID_BOOKING_STATE', `A ${booking.status.toLowerCase().replace('_', ' ')} booking cannot be checked in`);
  }
  const now = clock.now();
  if (now < booking.checkInOpensAt) {
    throw unprocessable('CHECK_IN_TOO_EARLY', `Check-in opens at ${formatLocal(booking.checkInOpensAt, 'HH:mm')}`);
  }
  if (now > booking.checkInClosesAt) {
    throw unprocessable('CHECK_IN_CLOSED', `The check-in window closed at ${formatLocal(booking.checkInClosesAt, 'HH:mm')}`);
  }

  const updated = await transitionBooking(
    booking._id,
    'CONFIRMED',
    'CHECKED_IN',
    { set: { checkedInAt: now, checkInStatus: 'CHECKED_IN' }, by: user._id, note: 'QR check-in' },
  );
  if (!updated) {
    const current = await Booking.findById(booking._id).select('status');
    if (current?.status === 'CHECKED_IN') throw conflict('ALREADY_CHECKED_IN', 'You have already checked in to this booking');
    throw conflict('INVALID_STATE_TRANSITION', 'This booking changed state. Refresh and try again.');
  }
  emitBookingChange('booking.checkedIn', updated);
  return updated;
}

/** Which actions the viewer may take right now (the UI only renders these; the server re-checks on submit). */
export function bookingActions(booking, viewer, resource, now = clock.now()) {
  const isOwner = String(booking.user?._id || booking.user) === String(viewer._id);
  const isAdmin = viewer.role === 'ADMIN';
  const open = ['PENDING_APPROVAL', 'CONFIRMED'].includes(booking.status);
  const ownerCanCancel =
    isOwner &&
    open &&
    now < booking.startAt &&
    (booking.status === 'PENDING_APPROVAL' || now <= booking.cancellationDeadlineAt || isAdmin);
  return {
    cancel: ownerCanCancel || (isAdmin && open && now < booking.endAt),
    checkIn: isOwner && booking.status === 'CONFIRMED' && now >= booking.checkInOpensAt && now <= booking.checkInClosesAt,
    review: booking.status === 'PENDING_APPROVAL' && canReview(viewer, booking, resource) && now < booking.startAt,
  };
}

export async function getBookingForViewer(bookingId, viewer) {
  const booking = await Booking.findById(bookingId)
    .populate('resource', 'name location category status approvers bookingRules.checkInGraceMinutes')
    .populate('approvedBy rejectedBy cancelledBy', 'name role');
  if (!booking) throw notFound('Booking');
  const isOwner = String(booking.user) === String(viewer._id);
  const resource = booking.resource;
  const isApprover = viewer.role === 'FACULTY' && (resource?.approvers || []).some((a) => String(a) === String(viewer._id));
  if (!isOwner && viewer.role !== 'ADMIN' && !isApprover) {
    throw forbidden('You do not have access to this booking');
  }
  const data = booking.toObject();
  if (data.resource) delete data.resource.approvers;
  data.actions = bookingActions(booking, viewer, resource);
  return data;
}

const SCOPES = {
  upcoming: (now) => ({ status: { $in: ['CONFIRMED', 'CHECKED_IN'] }, endAt: { $gt: now } }),
  pending: () => ({ status: 'PENDING_APPROVAL' }),
  completed: () => ({ status: 'COMPLETED' }),
  cancelled: () => ({ status: { $in: ['CANCELLED', 'REJECTED', 'EXPIRED'] } }),
  noshow: () => ({ status: 'NO_SHOW' }),
  all: () => ({}),
};

export async function listMyBookings(user, { scope, resource, status, page, limit }) {
  const now = clock.now();
  const filter = { user: user._id, ...SCOPES[scope](now) };
  if (resource) filter.resource = resource;
  if (status) filter.status = status;
  const ascending = ['upcoming', 'pending'].includes(scope);
  const [items, total] = await Promise.all([
    Booking.find(filter)
      .select('-statusHistory')
      .sort({ startAt: ascending ? 1 : -1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Booking.countDocuments(filter),
  ]);
  for (const item of items) item.actions = bookingActions(item, user, null, now);
  return { items, total };
}

/** Pending approvals visible to the reviewer, highest priority first, then oldest request first. */
export async function listPendingApprovals(reviewer, { resource, page, limit }) {
  const filter = { status: 'PENDING_APPROVAL', startAt: { $gt: clock.now() } };
  if (reviewer.role === 'FACULTY') {
    const assigned = await Resource.find({ approvers: reviewer._id }).distinct('_id');
    filter.resource = { $in: assigned };
  }
  if (resource) filter.resource = filter.resource ? { $in: filter.resource.$in.filter((id) => String(id) === resource) } : resource;
  filter.user = { $ne: reviewer._id };
  const [items, total] = await Promise.all([
    Booking.find(filter)
      .select('-statusHistory')
      .sort({ priority: -1, createdAt: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Booking.countDocuments(filter),
  ]);
  return { items, total };
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function adminListBookings({ search, resource, user, status, approvalStatus, date, from, to, page, limit, sort }) {
  const filter = {};
  if (resource) filter.resource = resource;
  if (user) filter.user = user;
  if (status) filter.status = status;
  if (approvalStatus) filter.approvalStatus = approvalStatus;
  if (date) filter.date = date;
  if (from || to) {
    filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  }
  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ code: re }, { 'userSnapshot.name': re }, { 'userSnapshot.email': re }, { 'resourceSnapshot.name': re }, { purpose: re }];
  }
  const [items, total] = await Promise.all([
    Booking.find(filter)
      .select('-statusHistory')
      .sort(sort === 'startAt' ? { startAt: 1 } : sort === 'createdAt' ? { createdAt: -1 } : { startAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Booking.countDocuments(filter),
  ]);
  return { items, total };
}

/** Bookings the user can check in to at a resource right now (used by the QR landing page). */
export async function checkInCandidates(user, resourceId) {
  const now = clock.now();
  return Booking.find({
    user: user._id,
    resource: resourceId,
    status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
    endAt: { $gt: now },
    checkInOpensAt: { $lte: new Date(now.getTime() + 6 * 60 * 60 * 1000) },
  })
    .select('code date startTime endTime status checkInOpensAt checkInClosesAt resourceSnapshot')
    .sort({ startAt: 1 })
    .lean();
}

export { ACTIVE_STATUSES };
