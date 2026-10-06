import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { notificationApi } from '../api/endpoints.js';
import { Button, Card, cx, EmptyState, ErrorState, Loading, PageHeader, Pagination, Tabs } from '../components/ui.jsx';
import { useToast } from '../hooks/useToast.jsx';
import { formatDateTime, relativeTime } from '../utils/format.js';

export default function Notifications() {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['notifications', 'list', filter, page],
    queryFn: () => notificationApi.list({ page, unread: filter === 'unread' ? 'true' : undefined }),
    placeholderData: keepPreviousData,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = useMutation({ mutationFn: notificationApi.markRead, onSuccess: invalidate });
  const markAll = useMutation({
    mutationFn: notificationApi.markAllRead,
    onSuccess: (res) => (invalidate(), toast.success(res.message)),
  });

  const target = (n) => (n.booking ? `/bookings/${n.booking}` : n.waitlistEntry ? '/my-bookings?tab=waitlist' : n.type === 'RESTRICTION' ? '/profile' : null);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        actions={
          <Button variant="secondary" loading={markAll.isPending} loadingText="Marking…" disabled={!data?.meta?.unreadCount} onClick={() => markAll.mutate()}>
            Mark all as read
          </Button>
        }
      />
      <Tabs
        tabs={[
          { value: 'all', label: 'All' },
          { value: 'unread', label: 'Unread', count: data?.meta?.unreadCount },
        ]}
        value={filter}
        onChange={(v) => (setFilter(v), setPage(1))}
      />
      {isPending ? (
        <Loading label="Loading notifications…" />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : data.data.length === 0 ? (
        <EmptyState title={filter === 'unread' ? 'You’re all caught up.' : 'No notifications yet.'} description="Booking confirmations, approvals, reminders and waitlist offers appear here." />
      ) : (
        <>
          <Card>
            <ul className="divide-y divide-slate-100">
              {data.data.map((n) => {
                const to = target(n);
                return (
                  <li key={n._id} className={cx('flex gap-3 p-4', !n.isRead && 'bg-brand-50/50')}>
                    <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.isRead ? 'bg-transparent' : 'bg-brand-600')} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className={cx('text-sm', n.isRead ? 'text-slate-700' : 'font-semibold text-slate-900')}>
                        {n.title}
                        {!n.isRead && <span className="sr-only"> (unread)</span>}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-600">{n.message}</p>
                      <p className="mt-1 text-xs text-slate-400" title={formatDateTime(n.createdAt)}>
                        {relativeTime(n.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {to && (
                        <Link to={to} onClick={() => !n.isRead && markRead.mutate(n._id)} className="text-sm text-brand-700 hover:underline">
                          View
                        </Link>
                      )}
                      {!n.isRead && (
                        <button type="button" className="text-xs text-slate-500 hover:text-slate-800" onClick={() => markRead.mutate(n._id)}>
                          Mark read
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Pagination meta={data.meta} onPage={setPage} />
        </>
      )}
    </div>
  );
}
