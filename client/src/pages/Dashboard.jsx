import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router';
import { bookingApi, notificationApi, userApi, waitlistApi } from '../api/endpoints.js';
import BookingRow from '../components/BookingRow.jsx';
import { Alert, ButtonLink, Card, EmptyState, Loading, PageHeader, Stat, StatusBadge } from '../components/ui.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { formatDate, formatDateTime, relativeTime, timeRange } from '../utils/format.js';
import { WAITLIST_STATUS } from '../utils/status.js';

function Section({ title, link, children }) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        {link && (
          <Link to={link.to} className="text-sm text-brand-700 hover:underline">
            {link.label}
          </Link>
        )}
      </div>
      {children}
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const upcoming = useQuery({ queryKey: ['bookings', 'mine', 'upcoming', 1], queryFn: () => bookingApi.mine({ scope: 'upcoming', limit: 3 }) });
  const pending = useQuery({ queryKey: ['bookings', 'mine', 'pending', 1], queryFn: () => bookingApi.mine({ scope: 'pending', limit: 3 }) });
  const recent = useQuery({ queryKey: ['bookings', 'mine', 'all', 1], queryFn: () => bookingApi.mine({ scope: 'all', limit: 5 }) });
  const waitlist = useQuery({ queryKey: ['waitlist', 'active'], queryFn: () => waitlistApi.mine({ status: 'active', limit: 5 }) });
  const standing = useQuery({ queryKey: ['standing'], queryFn: userApi.standing });
  const notifications = useQuery({ queryKey: ['notifications', 'list', 'dashboard'], queryFn: () => notificationApi.list({ limit: 5 }) });
  const approvals = useQuery({
    queryKey: ['approvals', 'count'],
    queryFn: () => bookingApi.pendingApprovals({ limit: 1 }),
    enabled: user.role === 'FACULTY',
  });

  if (user.role === 'ADMIN') return <Navigate to="/admin" replace />;

  const s = standing.data;
  const next = upcoming.data?.data?.[0];
  const offers = waitlist.data?.data?.filter((e) => e.status === 'OFFERED') || [];

  return (
    <div>
      <PageHeader title={`Welcome, ${user.name.split(' ')[0]}`} description="Your bookings at a glance." actions={<ButtonLink to="/resources">Book a resource</ButtonLink>} />

      {s?.activeRestriction && (
        <Alert tone="error" className="mb-4" title="Booking privileges restricted">
          You cannot make new bookings until {formatDateTime(s.activeRestriction.endsAt)}. Reason: {s.activeRestriction.reason}
        </Alert>
      )}
      {s && !s.activeRestriction && s.recentNoShows.length > 0 && (
        <Alert tone="warning" className="mb-4" title={`${s.recentNoShows.length} no-show${s.recentNoShows.length > 1 ? 's' : ''} in the last ${s.noShowLookbackDays} days`}>
          Please check in to your bookings or cancel them in time — repeated no-shows lead to temporary restrictions.{' '}
          <Link to="/profile" className="underline">
            View policy
          </Link>
        </Alert>
      )}
      {offers.map((offer) => (
        <Alert key={offer._id} tone="info" className="mb-4" title="A waitlisted slot is available for you">
          {offer.resourceSnapshot?.name} on {formatDate(offer.date)}, {timeRange(offer)}.{' '}
          <Link to="/my-bookings?tab=waitlist" className="font-medium underline">
            Accept it before it expires
          </Link>
        </Alert>
      ))}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Upcoming" value={upcoming.data?.meta.total ?? '–'} />
        <Stat label="Pending approval" value={pending.data?.meta.total ?? '–'} tone={pending.data?.meta.total ? 'warning' : undefined} />
        <Stat label="Active bookings" value={s ? `${s.activeBookings} / ${s.maxActiveBookings}` : '–'} hint="Campus-wide limit for your role" />
        {user.role === 'FACULTY' ? (
          <Stat label="Requests to review" value={approvals.data?.meta.total ?? '–'} tone={approvals.data?.meta.total ? 'warning' : undefined} />
        ) : (
          <Stat label="Waitlists" value={waitlist.data?.meta.total ?? '–'} />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Next booking" link={{ to: '/my-bookings', label: 'All bookings' }}>
            {upcoming.isPending ? (
              <Loading />
            ) : next ? (
              <ul>
                <BookingRow booking={next} />
              </ul>
            ) : (
              <div className="p-4">
                <EmptyState title="You have no upcoming bookings." action={<ButtonLink to="/resources">Browse resources</ButtonLink>} />
              </div>
            )}
          </Section>
          {pending.data?.data?.length > 0 && (
            <Section title="Pending approval" link={{ to: '/my-bookings?tab=pending', label: 'View all' }}>
              <ul className="divide-y divide-slate-100">
                {pending.data.data.map((b) => (
                  <BookingRow key={b._id} booking={b} />
                ))}
              </ul>
            </Section>
          )}
          <Section title="Recent bookings" link={{ to: '/my-bookings?tab=all', label: 'History' }}>
            {recent.isPending ? (
              <Loading />
            ) : recent.data?.data?.length ? (
              <ul className="divide-y divide-slate-100">
                {recent.data.data.map((b) => (
                  <BookingRow key={b._id} booking={b} />
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-slate-500">No bookings yet.</p>
            )}
          </Section>
        </div>
        <div className="space-y-6">
          <Section title="Waitlist status" link={{ to: '/my-bookings?tab=waitlist', label: 'Manage' }}>
            {waitlist.data?.data?.length ? (
              <ul className="divide-y divide-slate-100">
                {waitlist.data.data.map((e) => (
                  <li key={e._id} className="p-4 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800">{e.resourceSnapshot?.name}</span>
                      <StatusBadge map={WAITLIST_STATUS} status={e.status} />
                    </div>
                    <p className="text-slate-500">
                      {formatDate(e.date)} · {timeRange(e)}
                      {e.position ? ` · #${e.position} in line` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-slate-500">You are not on any waitlists.</p>
            )}
          </Section>
          <Section title="Notifications" link={{ to: '/notifications', label: 'View all' }}>
            {notifications.data?.data?.length ? (
              <ul className="divide-y divide-slate-100">
                {notifications.data.data.map((n) => (
                  <li key={n._id} className="p-4 text-sm">
                    <p className={n.isRead ? 'text-slate-700' : 'font-semibold text-slate-900'}>{n.title}</p>
                    <p className="text-xs text-slate-500">{relativeTime(n.createdAt)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-slate-500">No notifications yet.</p>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
