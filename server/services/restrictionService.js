import { activeRestrictionFilter, Restriction } from '../models/Restriction.js';
import { User } from '../models/User.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/AppError.js';
import { clock } from '../utils/clock.js';
import { addMinutes, formatLocal } from '../utils/time.js';
import { audit } from './auditService.js';
import { notify } from './notificationService.js';

export async function getActiveRestriction(userId, now = clock.now()) {
  return Restriction.findOne({ user: userId, ...activeRestrictionFilter(now) }).sort({ endsAt: -1 });
}

export async function assertNotRestricted(user, now = clock.now()) {
  const restriction = await getActiveRestriction(user._id, now);
  if (restriction) {
    throw forbidden(
      `Your booking privileges are restricted until ${formatLocal(restriction.endsAt)}. Reason: ${restriction.reason}`,
      'USER_RESTRICTED',
    );
  }
}

export async function createManualRestriction(userId, { days, reason }, admin) {
  const user = await User.findById(userId);
  if (!user) throw notFound('User');
  if (user.role === 'ADMIN') throw badRequest('CANNOT_RESTRICT_ADMIN', 'Administrators cannot be restricted');
  const now = clock.now();
  const restriction = await Restriction.create({
    user: user._id,
    source: 'ADMIN',
    reason,
    startsAt: now,
    endsAt: addMinutes(now, days * 24 * 60),
    createdBy: admin._id,
  });
  await notify({
    user: user._id,
    type: 'RESTRICTION',
    title: 'Booking privileges restricted',
    message: `An administrator restricted your bookings until ${formatLocal(restriction.endsAt)}. Reason: ${reason}`,
  });
  await audit({
    actor: admin,
    action: 'RESTRICTION_APPLIED',
    entityType: 'User',
    entityId: user._id,
    summary: `Restricted ${user.email} for ${days} day(s)`,
    details: { reason, endsAt: restriction.endsAt },
  });
  return restriction;
}

export async function liftRestriction(restrictionId, { reason }, admin) {
  const now = clock.now();
  const restriction = await Restriction.findOneAndUpdate(
    { _id: restrictionId, liftedAt: null },
    { liftedAt: now, liftedBy: admin._id, liftReason: reason },
    { new: true },
  );
  if (!restriction) {
    if (await Restriction.exists({ _id: restrictionId })) throw conflict('ALREADY_LIFTED', 'This restriction was already lifted');
    throw notFound('Restriction');
  }
  await notify({
    user: restriction.user,
    type: 'RESTRICTION',
    title: 'Booking restriction lifted',
    message: 'An administrator lifted your booking restriction. You can book resources again.',
  });
  await audit({
    actor: admin,
    action: 'RESTRICTION_LIFTED',
    entityType: 'User',
    entityId: restriction.user,
    summary: 'Lifted booking restriction',
    details: { restrictionId: restriction._id, reason },
  });
  return restriction;
}
