import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { bookingApi, waitlistApi } from '../api/endpoints.js';
import BookingRow from '../components/BookingRow.jsx';
import { Button, ButtonLink, Card, EmptyState, ErrorState, Loading, PageHeader, Pagination, StatusBadge, Tabs } from '../components/ui.jsx';
import { useToast } from '../hooks/useToast.jsx';
import { formatDate, formatTime, timeRange } from '../utils/format.js';
import { WAITLIST_STATUS } from '../utils/status.js';

const TABS = [
  { value: 'upcoming', label: 'Upcoming', empty: 'You have no upcoming bookings.' },
  { value: 'pending', label: 'Pending approval', empty: 'No booking requests are awaiting approval.' },
  { value: 'waitlist', label: 'Waitlist', empty: 'You are not on any waitlists.' },
  { value: 'completed', label: 'Completed', empty: 'No completed bookings yet.' },
  { value: 'cancelled', label: 'Cancelled / rejected', empty: 'No cancelled or rejected bookings.' },
  { value: 'noshow', label: 'No-show', empty: 'No missed bookings. Keep it up!' },
  { value: 'all', label: 'All history', empty: 'You have not made any bookings yet.' },
];

function Countdown({ until }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = Math.max(0, new Date(until).getTime() - now);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return (
    <span className="font-mono">
      {m}:{String(s).padStart(2, '0')}
    </span>
  );
}

function WaitlistTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['waitlist', page],
    queryFn: () => waitlistApi.mine({ page, limit: 10 }),
    placeholderData: keepPreviousData,
  });
  const action = useMutation({
    mutationFn: ({ kind, id }) => (kind === 'accept' ? waitlistApi.accept(id) : kind === 'decline' ? waitlistApi.decline(id) : waitlistApi.leave(id)),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ['waitlist'] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
    onError: (err) => {
      toast.error(err.message);
      queryClient.invalidateQueries({ queryKey: ['waitlist'] });
    },
  });

  if (isPending) return <Loading label="Loading waitlist…" />;
  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  if (data.data.length === 0) {
    return <EmptyState title="You are not on any waitlists." description="When a slot you want is taken, you can join its waitlist from the booking page." action={<ButtonLink to="/resources">Browse resources</ButtonLink>} />;
  }
  const busy = (id, kind) => action.isPending && action.variables?.id === id && action.variables?.kind === kind;
  return (
    <>
      <Card>
        <ul className="divide-y divide-slate-100">
          {data.data.map((entry) => (
            <li key={entry._id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/resources/${entry.resource}`} className="font-medium text-slate-900 hover:text-brand-700">
                    {entry.resourceSnapshot?.name}
                  </Link>
                  <StatusBadge map={WAITLIST_STATUS} status={entry.status} />
                </div>
                <p className="mt-0.5 text-sm text-slate-500">
                  {formatDate(entry.date)} · {timeRange(entry)}
                </p>
                {entry.status === 'WAITING' && <p className="text-sm text-slate-600">Position #{entry.position} in line</p>}
                {entry.status === 'OFFERED' && (
                  <p className="text-sm font-medium text-violet-700">
                    The slot is held for you until {formatTime(entry.offerExpiresAt)} (<Countdown until={entry.offerExpiresAt} /> left)
                  </p>
                )}
                {entry.status === 'ACCEPTED' && entry.booking && (
                  <Link to={`/bookings/${entry.booking}`} className="text-sm text-brand-700 hover:underline">
                    View booking
                  </Link>
                )}
              </div>
              <div className="flex gap-2">
                {entry.status === 'OFFERED' && (
                  <>
                    <Button size="sm" variant="success" loading={busy(entry._id, 'accept')} loadingText="Accepting…" onClick={() => action.mutate({ kind: 'accept', id: entry._id })}>
                      Accept
                    </Button>
                    <Button size="sm" variant="secondary" loading={busy(entry._id, 'decline')} onClick={() => action.mutate({ kind: 'decline', id: entry._id })}>
                      Decline
                    </Button>
                  </>
                )}
                {entry.status === 'WAITING' && (
                  <Button size="sm" variant="secondary" loading={busy(entry._id, 'leave')} loadingText="Leaving…" onClick={() => action.mutate({ kind: 'leave', id: entry._id })}>
                    Leave waitlist
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Pagination meta={data.meta} onPage={setPage} />
    </>
  );
}

function BookingsTab({ scope, empty }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [scope]);
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['bookings', 'mine', scope, page],
    queryFn: () => bookingApi.mine({ scope, page, limit: 10 }),
    placeholderData: keepPreviousData,
  });
  if (isPending) return <Loading label="Loading bookings…" />;
  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  if (data.data.length === 0) {
    return <EmptyState title={empty} action={<ButtonLink to="/resources">Browse resources</ButtonLink>} />;
  }
  return (
    <>
      <Card>
        <ul className="divide-y divide-slate-100">
          {data.data.map((b) => (
            <BookingRow key={b._id} booking={b} />
          ))}
        </ul>
      </Card>
      <Pagination meta={data.meta} onPage={setPage} />
    </>
  );
}

export default function MyBookings() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.value === params.get('tab')) || TABS[0];
  return (
    <div>
      <PageHeader title="My bookings" description="Your reservations, requests, waitlists and history." actions={<ButtonLink to="/resources">New booking</ButtonLink>} />
      <Tabs tabs={TABS} value={tab.value} onChange={(value) => setParams({ tab: value }, { replace: true })} />
      {tab.value === 'waitlist' ? <WaitlistTab /> : <BookingsTab scope={tab.value} empty={tab.empty} />}
    </div>
  );
}
