import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { adminApi, bookingApi } from '../../api/endpoints.js';
import { ReviewButtons } from '../../components/BookingActions.jsx';
import { BarList } from '../../components/charts.jsx';
import { Button, ButtonLink, Card, ErrorState, Loading, PageHeader, Stat } from '../../components/ui.jsx';
import { useToast } from '../../hooks/useToast.jsx';
import { formatDate, timeRange } from '../../utils/format.js';

export default function AdminDashboard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: ['admin', 'dashboard'], queryFn: adminApi.dashboard });
  const approvals = useQuery({ queryKey: ['approvals', 'dashboard'], queryFn: () => bookingApi.pendingApprovals({ limit: 5 }) });
  const runJobs = useMutation({
    mutationFn: adminApi.runJobs,
    onSuccess: (res) => {
      const r = res.data;
      toast.success(
        `Jobs ran: ${r.markNoShows?.processed ?? 0} no-show(s), ${r.completeBookings?.completed ?? 0} completed, ${r.expirePendingApprovals?.expired ?? 0} expired, ${r.expireWaitlist?.expiredOffers ?? 0} offer(s) expired, ${r.promoteWaitlists?.offers ?? 0} waitlist offer(s).`,
      );
      queryClient.invalidateQueries();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isPending) return <Loading label="Loading dashboard…" />;
  if (isError) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <div>
      <PageHeader
        title="Admin dashboard"
        description="Campus resource activity at a glance."
        actions={
          <>
            <Button variant="secondary" loading={runJobs.isPending} loadingText="Running jobs…" onClick={() => runJobs.mutate()}>
              Run scheduled jobs now
            </Button>
            <ButtonLink to="/admin/resources/new">Add resource</ButtonLink>
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Resources" value={data.resources.total} hint={`${data.resources.active} active · ${data.resources.maintenance} maintenance · ${data.resources.inactive} inactive`} />
        <Stat label="Today's bookings" value={data.todaysBookings} />
        <Stat label="Pending approvals" value={data.pendingApprovals} tone={data.pendingApprovals ? 'warning' : undefined} />
        <Stat label="Active users (30 days)" value={data.activeUsers30d} />
        <Stat label="Utilisation (7 days)" value={`${data.last7Days.utilizationPercent}%`} hint="Booked hours ÷ open hours" />
        <Stat label="No-show rate (7 days)" value={`${data.last7Days.noShowRate}%`} tone={data.last7Days.noShowRate > 15 ? 'danger' : undefined} />
        <Stat label="No-shows (30 days)" value={data.noShows30d} />
        <Stat label="Active restrictions" value={data.activeRestrictions} hint={<Link to="/admin/users?restricted=true" className="text-brand-700 hover:underline">View users</Link>} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Peak resources · last 7 days</h2>
            <Link to="/admin/analytics" className="text-sm text-brand-700 hover:underline">
              Full analytics
            </Link>
          </div>
          <BarList data={data.last7Days.peakResources} labelKey="name" valueKey="bookedHours" format={(v) => `${v} h`} detail={(d) => `· ${d.utilizationPercent}%`} />
        </Card>
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h2 className="font-semibold text-slate-900">Pending approvals</h2>
            <Link to="/approvals" className="text-sm text-brand-700 hover:underline">
              View all
            </Link>
          </div>
          {approvals.isPending ? (
            <Loading />
          ) : approvals.data?.data.length ? (
            <ul className="divide-y divide-slate-100">
              {approvals.data.data.map((b) => (
                <li key={b._id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div className="text-sm">
                    <Link to={`/bookings/${b._id}`} className="font-medium text-slate-900 hover:text-brand-700">
                      {b.resourceSnapshot.name}
                    </Link>
                    <p className="text-slate-500">
                      {b.userSnapshot.name} · {formatDate(b.date)} · {timeRange(b)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <ReviewButtons booking={b} size="sm" />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-sm text-slate-500">No pending approvals.</p>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['/admin/resources', 'Resources'],
          ['/admin/bookings', 'Bookings'],
          ['/admin/users', 'Users & restrictions'],
          ['/admin/analytics', 'Analytics'],
          ['/admin/policy', 'Booking policy'],
          ['/admin/audit', 'Audit log'],
        ].map(([to, label]) => (
          <Link key={to} to={to} className="rounded-lg bg-white px-4 py-3 text-center text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:text-brand-700 hover:ring-brand-300">
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
