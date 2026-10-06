import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Booking } from '../models/Booking.js';
import { Resource } from '../models/Resource.js';
import { SlotLock } from '../models/SlotLock.js';
import { User } from '../models/User.js';
import { broadcast, emitToResource } from '../sockets/io.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/AppError.js';
import { clock } from '../utils/clock.js';
import { dayOfWeek, localToDate, timeToMinutes } from '../utils/time.js';
import { runInTransaction } from '../utils/transaction.js';
import { audit } from './auditService.js';
import { safeNotify } from './notificationService.js';
import { acquireSlotLocks, locksInInterval, releaseSlotLocks } from './slotLockService.js';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SORTS = {
  name: { name: 1 },
  '-name': { name: -1 },
  capacity: { capacity: 1, name: 1 },
  '-capacity': { capacity: -1, name: 1 },
  createdAt: { createdAt: 1 },
  '-createdAt': { createdAt: -1 },
};

/** Builds one dynamic query from whichever filters are present. */
export async function listResources(query, viewer) {
  const filter = {};
  const isAdmin = viewer.role === 'ADMIN';

  if (query.status) {
    if (!isAdmin && query.status === 'INACTIVE') return { items: [], total: 0 };
    filter.status = query.status;
  } else if (!isAdmin) {
    filter.status = { $in: ['ACTIVE', 'MAINTENANCE'] };
  }
  if (query.category) filter.category = query.category;
  if (query.location) filter.location = new RegExp(escapeRegex(query.location), 'i');
  if (query.minCapacity !== undefined) filter.capacity = { $gte: query.minCapacity };
  if (query.approvalRequired !== undefined) filter['bookingRules.approvalRequired'] = query.approvalRequired;
  if (query.search) {
    const re = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ name: re }, { description: re }, { location: re }, { facilities: re }];
  }

  if (query.date && query.startTime && query.endTime) {
    const startAt = localToDate(query.date, query.startTime);
    const endAt = localToDate(query.date, query.endTime);
    const busy = await SlotLock.distinct('resource', { slotStart: { $gte: startAt, $lt: endAt } });
    filter.status = 'ACTIVE';
    filter._id = { $nin: busy };
    filter.operatingHours = {
      $elemMatch: { day: dayOfWeek(query.date), open: { $lte: query.startTime }, close: { $gte: query.endTime } },
    };
  }

  const [items, total] = await Promise.all([
    Resource.find(filter)
      .select('-blockedPeriods -approvers')
      .sort(SORTS[query.sort])
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Resource.countDocuments(filter),
  ]);
  return { items, total };
}

export async function listLocations(viewer) {
  const filter = viewer.role === 'ADMIN' ? {} : { status: { $ne: 'INACTIVE' } };
  return (await Resource.distinct('location', filter)).sort();
}

export async function getResource(resourceId, viewer) {
  const resource = await Resource.findById(resourceId).populate('approvers', 'name email role');
  if (!resource || (resource.status === 'INACTIVE' && viewer.role !== 'ADMIN')) throw notFound('Resource');
  return resource;
}

export function canManageCheckIn(user, resource) {
  if (user.role === 'ADMIN') return true;
  const approvers = (resource.approvers || []).map((a) => String(a._id || a));
  return user.role === 'FACULTY' && approvers.includes(String(user._id));
}

async function assertApprovers(ids) {
  if (!ids?.length) return;
  const count = await User.countDocuments({ _id: { $in: ids }, role: { $in: ['FACULTY', 'ADMIN'] }, isActive: true });
  if (count !== new Set(ids).size) throw badRequest('INVALID_APPROVERS', 'Approvers must be active faculty or admin users');
}

function assertRuleConsistency(rules) {
  const slot = rules.slotMinutes;
  if (rules.minDurationMinutes > rules.maxDurationMinutes)
    throw badRequest('INVALID_RULES', 'Minimum duration cannot exceed maximum duration');
  if (rules.minDurationMinutes % slot || rules.maxDurationMinutes % slot)
    throw badRequest('INVALID_RULES', `Durations must be multiples of the ${slot}-minute slot length`);
  if (rules.minDurationMinutes < slot) throw badRequest('INVALID_RULES', 'Minimum duration must be at least one slot');
}

export async function createResource(data, admin) {
  await assertApprovers(data.approvers);
  const resource = new Resource({ ...data, createdBy: admin._id });
  assertRuleConsistency(resource.bookingRules);
  await resource.save();
  await audit({
    actor: admin,
    action: 'RESOURCE_CREATED',
    entityType: 'Resource',
    entityId: resource._id,
    summary: `Created resource "${resource.name}"`,
    details: { category: resource.category, location: resource.location, bookingRules: resource.bookingRules },
  });
  return resource;
}

export async function updateResource(resourceId, changes, admin) {
  const resource = await Resource.findById(resourceId);
  if (!resource) throw notFound('Resource');
  await assertApprovers(changes.approvers);

  const before = {
    name: resource.name,
    location: resource.location,
    bookingRules: resource.bookingRules.toObject(),
    operatingHours: resource.operatingHours.map((h) => h.toObject()),
  };
  const { bookingRules, ...rest } = changes;
  resource.set(rest);
  if (bookingRules) resource.bookingRules = { ...resource.bookingRules.toObject(), ...bookingRules };
  assertRuleConsistency(resource.bookingRules);
  await resource.save();

  const policyChanged = Boolean(bookingRules || changes.operatingHours);
  await audit({
    actor: admin,
    action: policyChanged ? 'RESOURCE_POLICY_UPDATED' : 'RESOURCE_UPDATED',
    entityType: 'Resource',
    entityId: resource._id,
    summary: `Updated resource "${resource.name}"`,
    details: { before, changes },
  });
  emitToResource(resource._id, 'resource.updated', { resourceId: String(resource._id) });
  return resource;
}

/**
 * Changes ACTIVE/INACTIVE/MAINTENANCE. New bookings are blocked immediately
 * (booking validation checks status). Existing future bookings are either
 * kept (users are informed) or explicitly cancelled with a recorded reason —
 * never silently deleted.
 */
export async function changeResourceStatus(resourceId, { status, reason, cancelExistingBookings }, admin) {
  const resource = await Resource.findById(resourceId);
  if (!resource) throw notFound('Resource');
  const previous = resource.status;
  resource.status = status;
  resource.statusReason = reason;
  await resource.save();

  const now = clock.now();
  const upcoming = await Booking.find({
    resource: resource._id,
    status: { $in: ['PENDING_APPROVAL', 'CONFIRMED'] },
    startAt: { $gt: now },
  });

  let cancelled = 0;
  if (status !== 'ACTIVE' && cancelExistingBookings) {
    const { cancelBooking } = await import('./bookingService.js');
    for (const booking of upcoming) {
      try {
        await cancelBooking(booking._id, admin, {
          reason: `Resource ${status === 'MAINTENANCE' ? 'under maintenance' : 'deactivated'}${reason ? `: ${reason}` : ''}`,
          system: true,
        });
        cancelled += 1;
      } catch {
        // Booking changed state concurrently (e.g. user cancelled); nothing to do.
      }
    }
  } else if (status !== 'ACTIVE' && previous !== status) {
    for (const booking of upcoming) {
      await safeNotify({
        user: booking.user,
        type: 'RESOURCE_STATUS',
        title: `${resource.name} is ${status === 'MAINTENANCE' ? 'under maintenance' : 'unavailable'}`,
        message: `Your booking on ${booking.date} (${booking.startTime}–${booking.endTime}) is still held, but please check with the administrator.${reason ? ` Reason: ${reason}` : ''}`,
        booking: booking._id,
        resource: resource._id,
      });
    }
  }

  await audit({
    actor: admin,
    action: 'RESOURCE_STATUS_CHANGED',
    entityType: 'Resource',
    entityId: resource._id,
    summary: `Changed "${resource.name}" status ${previous} → ${status}`,
    details: { previous, status, reason, cancelExistingBookings, affectedBookings: upcoming.length, cancelled },
  });
  broadcast('resource.statusChanged', { resourceId: String(resource._id), status });
  return { resource, affectedBookings: upcoming.length, cancelledBookings: cancelled };
}

/** Admin-defined blocked period (exam, event). Uses the same slot locks as bookings. */
export async function addBlockedPeriod(resourceId, { date, startTime, endTime, reason }, admin) {
  const resource = await Resource.findById(resourceId);
  if (!resource) throw notFound('Resource');
  const startAt = localToDate(date, startTime);
  const endAt = localToDate(date, endTime);
  if (endAt <= clock.now()) throw badRequest('BLOCK_IN_PAST', 'Blocked period must end in the future');

  const blockId = new mongoose.Types.ObjectId();
  try {
    await runInTransaction(
      async (ctx) => {
        await acquireSlotLocks({ resourceId: resource._id, startAt, endAt, ownerType: 'BLOCK', ownerId: blockId }, ctx.session);
        await Resource.updateOne(
          { _id: resource._id },
          { $push: { blockedPeriods: { _id: blockId, date, startTime, endTime, startAt, endAt, reason, createdBy: admin._id } } },
          { session: ctx.session },
        );
        await audit(
          {
            actor: admin,
            action: 'RESOURCE_BLOCK_ADDED',
            entityType: 'Resource',
            entityId: resource._id,
            summary: `Blocked "${resource.name}" on ${date} ${startTime}–${endTime}`,
            details: { reason },
          },
          ctx,
        );
        ctx.afterCommit(() => emitToResource(resource._id, 'availability.updated', { resourceId: String(resource._id), date }));
      },
      { compensate: () => releaseSlotLocks(blockId) },
    );
  } catch (error) {
    if (error.code === 'BOOKING_CONFLICT') {
      const locks = await locksInInterval(resource._id, startAt, endAt);
      const bookingIds = locks.filter((l) => l.ownerType === 'BOOKING').map((l) => l.ownerId);
      const bookings = await Booking.find({ _id: { $in: bookingIds } }).select('code startTime endTime status');
      throw conflict(
        'BLOCK_CONFLICT',
        'This period overlaps existing bookings, blocks or waitlist offers. Cancel or move them first.',
        bookings.map((b) => ({ code: b.code, time: `${b.startTime}–${b.endTime}`, status: b.status })),
      );
    }
    throw error;
  }
  return Resource.findById(resource._id);
}

export async function removeBlockedPeriod(resourceId, blockId, admin) {
  const resource = await Resource.findById(resourceId);
  if (!resource) throw notFound('Resource');
  const block = resource.blockedPeriods.id(blockId);
  if (!block) throw notFound('Blocked period');
  await Resource.updateOne({ _id: resource._id }, { $pull: { blockedPeriods: { _id: block._id } } });
  await releaseSlotLocks(block._id);
  await audit({
    actor: admin,
    action: 'RESOURCE_BLOCK_REMOVED',
    entityType: 'Resource',
    entityId: resource._id,
    summary: `Removed block on "${resource.name}" ${block.date} ${block.startTime}–${block.endTime}`,
  });
  emitToResource(resource._id, 'availability.updated', { resourceId: String(resource._id), date: block.date });
  const { promoteWaitlistForResource } = await import('./waitlistService.js');
  await promoteWaitlistForResource(resource._id);
  return Resource.findById(resource._id);
}

/**
 * Venue check-in QR: a short-lived JWT bound to this resource. The kiosk at the
 * venue rotates it continuously, so a photographed code expires within
 * QR_TOKEN_TTL_SECONDS and cannot be used for a different resource.
 */
export async function issueCheckInToken(resourceId, user) {
  const resource = await Resource.findById(resourceId);
  if (!resource) throw notFound('Resource');
  if (!canManageCheckIn(user, resource)) throw forbidden('Only admins or assigned faculty can display the check-in code');
  const ttl = env.QR_TOKEN_TTL_SECONDS;
  const token = jwt.sign({ typ: 'checkin', rid: String(resource._id) }, env.QR_TOKEN_SECRET, { expiresIn: ttl });
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const checkInUrl = `${env.CLIENT_URLS[0]}/check-in?resource=${resource._id}&token=${encodeURIComponent(token)}`;
  return { token, expiresAt, ttlSeconds: ttl, checkInUrl, resource: { _id: resource._id, name: resource.name, location: resource.location } };
}

export function operatingWindow(resource, date) {
  const hours = resource.operatingHours.find((h) => h.day === dayOfWeek(date));
  if (!hours) return null;
  return { open: hours.open, close: hours.close, openMinutes: timeToMinutes(hours.open), closeMinutes: timeToMinutes(hours.close) };
}
