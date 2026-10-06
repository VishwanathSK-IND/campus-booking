import { Booking } from '../models/Booking.js';
import { NoShowRecord } from '../models/NoShowRecord.js';
import { activeRestrictionFilter, Restriction } from '../models/Restriction.js';
import { publicUser, User } from '../models/User.js';
import { badRequest, conflict, notFound } from '../utils/AppError.js';
import { clock } from '../utils/clock.js';
import { addMinutes } from '../utils/time.js';
import { audit } from './auditService.js';
import { hashPassword } from './authService.js';
import { getPolicy } from './policyService.js';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function listUsers({ search, role, restricted, active, page, limit }) {
  const now = clock.now();
  const filter = {};
  if (role) filter.role = role;
  if (active !== undefined) filter.isActive = active;
  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: re }, { email: re }, { department: re }];
  }
  if (restricted !== undefined) {
    const restrictedIds = await Restriction.distinct('user', activeRestrictionFilter(now));
    filter._id = restricted ? { $in: restrictedIds } : { $nin: restrictedIds };
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);
  const ids = users.map((u) => u._id);
  const policy = await getPolicy();
  const since = addMinutes(now, -policy.noShow.lookbackDays * 24 * 60);
  const [restrictions, noShows] = await Promise.all([
    Restriction.find({ user: { $in: ids }, ...activeRestrictionFilter(now) }).lean(),
    NoShowRecord.aggregate([
      { $match: { user: { $in: ids }, occurredAt: { $gte: since }, waived: false } },
      { $group: { _id: '$user', count: { $sum: 1 } } },
    ]),
  ]);
  const restrictionByUser = new Map(restrictions.map((r) => [String(r.user), r]));
  const noShowsByUser = new Map(noShows.map((n) => [String(n._id), n.count]));
  const items = users.map((u) => ({
    ...publicUser(u),
    lastLoginAt: u.lastLoginAt,
    activeRestriction: restrictionByUser.get(String(u._id)) || null,
    recentNoShows: noShowsByUser.get(String(u._id)) || 0,
  }));
  return { items, total };
}

export async function getUserDetail(userId) {
  const user = await User.findById(userId);
  if (!user) throw notFound('User');
  const [restrictions, noShows, bookingStats] = await Promise.all([
    Restriction.find({ user: user._id }).sort({ createdAt: -1 }).limit(20).lean(),
    NoShowRecord.find({ user: user._id }).sort({ occurredAt: -1 }).limit(20).populate('booking', 'code date startTime endTime resourceSnapshot').lean(),
    Booking.aggregate([{ $match: { user: user._id } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);
  const now = clock.now();
  return {
    user: { ...publicUser(user), lastLoginAt: user.lastLoginAt },
    restrictions: restrictions.map((r) => ({ ...r, active: !r.liftedAt && r.startsAt <= now && r.endsAt > now })),
    noShows,
    bookingStats: Object.fromEntries(bookingStats.map((s) => [s._id, s.count])),
  };
}

/** Admin provisioning of faculty/admin (and student) accounts. */
export async function createUser({ name, email, password, role, department }, admin) {
  if (await User.exists({ email })) throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
  const user = await User.create({ name, email, role, department, password: await hashPassword(password) });
  await audit({
    actor: admin,
    action: 'USER_CREATED',
    entityType: 'User',
    entityId: user._id,
    summary: `Created ${role.toLowerCase()} account ${email}`,
  });
  return publicUser(user);
}

export async function updateUser(userId, changes, admin) {
  const user = await User.findById(userId);
  if (!user) throw notFound('User');
  if (String(user._id) === String(admin._id) && (changes.role && changes.role !== 'ADMIN' || changes.isActive === false)) {
    throw badRequest('SELF_LOCKOUT', 'You cannot remove your own admin access or deactivate yourself');
  }
  const before = { role: user.role, isActive: user.isActive, name: user.name, department: user.department };
  user.set(changes);
  await user.save();
  await audit({
    actor: admin,
    action: changes.role && changes.role !== before.role ? 'USER_ROLE_CHANGED' : 'USER_UPDATED',
    entityType: 'User',
    entityId: user._id,
    summary: `Updated ${user.email}${changes.role && changes.role !== before.role ? `: role ${before.role} → ${changes.role}` : ''}${changes.isActive === false ? ' (deactivated)' : ''}`,
    details: { before, changes },
  });
  return publicUser(user);
}

/** The signed-in user's standing: active restriction, recent no-shows and the escalation policy. */
export async function getStanding(user) {
  const now = clock.now();
  const policy = await getPolicy();
  const since = addMinutes(now, -policy.noShow.lookbackDays * 24 * 60);
  const [restriction, noShows, activeBookings] = await Promise.all([
    Restriction.findOne({ user: user._id, ...activeRestrictionFilter(now) }).sort({ endsAt: -1 }).lean(),
    NoShowRecord.find({ user: user._id, occurredAt: { $gte: since }, waived: false })
      .sort({ occurredAt: -1 })
      .populate('booking', 'code date startTime endTime resourceSnapshot')
      .lean(),
    Booking.countDocuments({ user: user._id, status: { $in: ['PENDING_APPROVAL', 'CONFIRMED', 'CHECKED_IN'] }, endAt: { $gt: now } }),
  ]);
  return {
    activeRestriction: restriction,
    recentNoShows: noShows,
    noShowLookbackDays: policy.noShow.lookbackDays,
    noShowTiers: policy.noShow.tiers,
    activeBookings,
    maxActiveBookings: policy.maxActiveBookingsByRole?.[user.role] ?? null,
  };
}
