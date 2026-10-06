import { Booking } from '../models/Booking.js';
import { NoShowRecord } from '../models/NoShowRecord.js';
import { Resource } from '../models/Resource.js';
import { activeRestrictionFilter, Restriction } from '../models/Restriction.js';
import { clock } from '../utils/clock.js';
import { addDays, dayOfWeek, startOfLocalDay, timeToMinutes, todayLocal, TZ } from '../utils/time.js';

const RESERVED = ['PENDING_APPROVAL', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW'];
// Time that was actually allocated to someone (counts towards utilisation).
const ALLOCATED = ['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW'];
const USED = ['CHECKED_IN', 'COMPLETED'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const countIf = (cond) => ({ $sum: { $cond: [cond, 1, 0] } });
const minutesIf = (statuses) => ({ $sum: { $cond: [{ $in: ['$status', statuses] }, '$durationMinutes', 0] } });
const ratio = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

/** Open minutes per resource in [from, to] derived from operating hours (capacity for utilisation %). */
function openMinutes(resource, from, to) {
  let total = 0;
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const hours = resource.operatingHours.find((h) => h.day === dayOfWeek(date));
    if (hours) total += timeToMinutes(hours.close) - timeToMinutes(hours.open);
  }
  return total;
}

/**
 * All metrics are computed by MongoDB aggregation over real booking records
 * in a single $facet pass; only utilisation capacity (from operating hours)
 * is combined in application code. Nothing is stored or pre-computed.
 */
export async function getAnalytics({ from, to, resource }, scopeResourceIds = null) {
  const match = { startAt: { $gte: startOfLocalDay(from), $lt: startOfLocalDay(addDays(to, 1)) } };
  if (scopeResourceIds) match.resource = { $in: scopeResourceIds };
  if (resource) {
    match.resource = scopeResourceIds ? { $in: scopeResourceIds.filter((id) => String(id) === String(resource)) } : resource;
  }

  const localStartMinutes = {
    $add: [{ $multiply: [{ $hour: { date: '$startAt', timezone: TZ } }, 60] }, { $minute: { date: '$startAt', timezone: TZ } }],
  };

  const [facets] = await Booking.aggregate([
    { $match: match },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        byResource: [
          {
            $group: {
              _id: '$resource',
              name: { $last: '$resourceSnapshot.name' },
              category: { $last: '$resourceSnapshot.category' },
              total: { $sum: 1 },
              allocatedMinutes: minutesIf(ALLOCATED),
              usedMinutes: minutesIf(USED),
              noShows: countIf({ $eq: ['$status', 'NO_SHOW'] }),
              cancelled: countIf({ $eq: ['$status', 'CANCELLED'] }),
            },
          },
          { $sort: { allocatedMinutes: -1, total: -1 } },
        ],
        // Each booking counts in every local hour it occupies (not just its start hour).
        peakHours: [
          { $match: { status: { $in: RESERVED } } },
          { $project: { startMinutes: localStartMinutes, durationMinutes: 1 } },
          {
            $project: {
              hours: {
                $range: [
                  { $toInt: { $floor: { $divide: ['$startMinutes', 60] } } },
                  { $toInt: { $ceil: { $divide: [{ $add: ['$startMinutes', '$durationMinutes'] }, 60] } } },
                ],
              },
            },
          },
          { $unwind: '$hours' },
          { $group: { _id: '$hours', bookings: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ],
        peakDays: [
          { $match: { status: { $in: RESERVED } } },
          {
            $group: {
              _id: { $dayOfWeek: { date: '$startAt', timezone: TZ } },
              bookings: { $sum: 1 },
              minutes: { $sum: '$durationMinutes' },
            },
          },
          { $sort: { _id: 1 } },
        ],
        trend: [
          {
            $group: {
              _id: '$date',
              total: { $sum: 1 },
              completed: countIf({ $eq: ['$status', 'COMPLETED'] }),
              cancelled: countIf({ $eq: ['$status', 'CANCELLED'] }),
              noShows: countIf({ $eq: ['$status', 'NO_SHOW'] }),
            },
          },
          { $sort: { _id: 1 } },
        ],
        users: [
          { $group: { _id: '$user', total: { $sum: 1 } } },
          { $group: { _id: null, users: { $sum: 1 }, bookings: { $sum: '$total' }, maxPerUser: { $max: '$total' } } },
        ],
      },
    },
  ]);

  const status = Object.fromEntries(facets.byStatus.map((s) => [s._id, s.count]));
  const get = (s) => status[s] || 0;
  const total = facets.byStatus.reduce((sum, s) => sum + s.count, 0);
  const reachedStart = get('CHECKED_IN') + get('COMPLETED') + get('NO_SHOW');

  const resourceFilter = scopeResourceIds ? { _id: { $in: scopeResourceIds } } : {};
  if (resource) resourceFilter._id = resource;
  const resources = await Resource.find(resourceFilter).select('name category location status operatingHours').lean();
  const statsById = new Map(facets.byResource.map((r) => [String(r._id), r]));

  const utilization = resources
    .map((r) => {
      const s = statsById.get(String(r._id)) || { total: 0, allocatedMinutes: 0, usedMinutes: 0, noShows: 0, cancelled: 0 };
      const available = openMinutes(r, from, to);
      return {
        resourceId: r._id,
        name: r.name,
        category: r.category,
        location: r.location,
        status: r.status,
        bookings: s.total,
        availableHours: Math.round(available / 6) / 10,
        bookedHours: Math.round(s.allocatedMinutes / 6) / 10,
        usedHours: Math.round(s.usedMinutes / 6) / 10,
        utilizationPercent: ratio(s.allocatedMinutes, available),
        usagePercent: ratio(s.usedMinutes, available),
        noShows: s.noShows,
        cancelled: s.cancelled,
      };
    })
    .sort((a, b) => b.bookedHours - a.bookedHours || b.bookings - a.bookings);

  const totalAvailable = utilization.reduce((sum, r) => sum + r.availableHours, 0);
  const totalBooked = utilization.reduce((sum, r) => sum + r.bookedHours, 0);
  const totalUsed = utilization.reduce((sum, r) => sum + r.usedHours, 0);
  const users = facets.users[0] || { users: 0, bookings: 0, maxPerUser: 0 };

  return {
    range: { from, to, timezone: TZ },
    totals: {
      total,
      pending: get('PENDING_APPROVAL'),
      confirmed: get('CONFIRMED'),
      checkedIn: get('CHECKED_IN'),
      completed: get('COMPLETED'),
      cancelled: get('CANCELLED'),
      rejected: get('REJECTED'),
      expired: get('EXPIRED'),
      noShows: get('NO_SHOW'),
    },
    rates: {
      cancellationRate: ratio(get('CANCELLED'), total),
      noShowRate: ratio(get('NO_SHOW'), reachedStart),
      rejectionRate: ratio(get('REJECTED'), get('REJECTED') + get('CONFIRMED') + reachedStart),
    },
    utilization: {
      availableHours: Math.round(totalAvailable * 10) / 10,
      bookedHours: Math.round(totalBooked * 10) / 10,
      usedHours: Math.round(totalUsed * 10) / 10,
      utilizationPercent: ratio(totalBooked, totalAvailable),
      usagePercent: ratio(totalUsed, totalAvailable),
      byResource: utilization,
    },
    mostUsedResources: utilization.filter((r) => r.bookings > 0).slice(0, 5),
    peakHours: facets.peakHours.map((h) => ({ hour: h._id, label: `${String(h._id).padStart(2, '0')}:00`, bookings: h.bookings })),
    peakDays: facets.peakDays.map((d) => ({ day: DAY_NAMES[d._id - 1], bookings: d.bookings, hours: Math.round(d.minutes / 6) / 10 })),
    trend: facets.trend.map((t) => ({ date: t._id, total: t.total, completed: t.completed, cancelled: t.cancelled, noShows: t.noShows })),
    userBehaviour: {
      activeBookers: users.users,
      bookingsPerUser: users.users ? Math.round((users.bookings / users.users) * 10) / 10 : 0,
      maxBookingsByOneUser: users.maxPerUser,
      cancellationRate: ratio(get('CANCELLED'), total),
      noShowRate: ratio(get('NO_SHOW'), reachedStart),
    },
  };
}

export async function getAdminDashboard() {
  const now = clock.now();
  const today = todayLocal(now);
  const thirtyDaysAgo = addDays(today, -30);
  const [resourcesByStatus, todaysBookings, pendingApprovals, activeUsers, noShows30d, activeRestrictions, analytics] = await Promise.all([
    Resource.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Booking.countDocuments({ date: today, status: { $in: RESERVED } }),
    Booking.countDocuments({ status: 'PENDING_APPROVAL', startAt: { $gt: now } }),
    Booking.distinct('user', { createdAt: { $gte: startOfLocalDay(thirtyDaysAgo) } }).then((ids) => ids.length),
    NoShowRecord.countDocuments({ occurredAt: { $gte: startOfLocalDay(thirtyDaysAgo) } }),
    Restriction.countDocuments(activeRestrictionFilter(now)),
    getAnalytics({ from: addDays(today, -6), to: today }),
  ]);
  const resources = Object.fromEntries(resourcesByStatus.map((r) => [r._id, r.count]));
  return {
    resources: {
      total: Object.values(resources).reduce((a, b) => a + b, 0),
      active: resources.ACTIVE || 0,
      maintenance: resources.MAINTENANCE || 0,
      inactive: resources.INACTIVE || 0,
    },
    todaysBookings,
    pendingApprovals,
    activeUsers30d: activeUsers,
    noShows30d,
    activeRestrictions,
    last7Days: {
      utilizationPercent: analytics.utilization.utilizationPercent,
      totals: analytics.totals,
      noShowRate: analytics.rates.noShowRate,
      peakResources: analytics.mostUsedResources.slice(0, 3),
    },
  };
}
