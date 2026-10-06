import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { bookingApi } from '../api/endpoints.js';
import { ReviewButtons } from '../components/BookingActions.jsx';
import { Badge, Card, EmptyState, ErrorState, Loading, PageHeader, Pagination } from '../components/ui.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { duration, formatDate, relativeTime, timeRange } from '../utils/format.js';

export default function Approvals() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['approvals', page],
    queryFn: () => bookingApi.pendingApprovals({ page, limit: 10 }),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader
        title="Pending approvals"
        description={
          user.role === 'ADMIN'
            ? 'All requests awaiting review. Ordered by priority, then by request time.'
            : 'Requests for resources you are assigned to review. Ordered by priority, then by request time.'
        }
      />
      {isPending ? (
        <Loading label="Loading requests…" />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : data.data.length === 0 ? (
        <EmptyState title="No pending approvals." description="New requests appear here automatically." />
      ) : (
        <>
          <Card>
            <ul className="divide-y divide-slate-100">
              {data.data.map((b) => (
                <li key={b._id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/bookings/${b._id}`} className="font-medium text-slate-900 hover:text-brand-700">
                        {b.resourceSnapshot.name}
                      </Link>
                      {b.priority > 1 && <Badge tone="violet">Priority · {b.userSnapshot.role.toLowerCase()}</Badge>}
                    </div>
                    <p className="text-sm text-slate-600">
                      {formatDate(b.date)} · {timeRange(b)} ({duration(b.durationMinutes)})
                    </p>
                    <p className="text-sm text-slate-600">
                      <span className="font-medium">{b.userSnapshot.name}</span> ({b.userSnapshot.role.toLowerCase()}) — “{b.purpose}”
                    </p>
                    <p className="text-xs text-slate-400">
                      {b.code} · requested {relativeTime(b.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <ReviewButtons booking={b} size="sm" />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Pagination meta={data.meta} onPage={setPage} />
        </>
      )}
    </div>
  );
}
