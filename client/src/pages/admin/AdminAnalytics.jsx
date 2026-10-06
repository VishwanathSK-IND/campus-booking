import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { adminApi, resourceApi } from '../../api/endpoints.js';
import { BarList, ColumnChart } from '../../components/charts.jsx';
import { Card, ErrorState, Field, Input, Loading, PageHeader, Select, Stat } from '../../components/ui.jsx';
import { useAuth } from '../../hooks/useAuth.jsx';
import { campusDate } from '../../utils/format.js';

const PRESETS = [
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
];

export default function AdminAnalytics() {
  const { user } = useAuth();
  const [range, setRange] = useState({ from: campusDate(-29), to: campusDate() });
  const [resource, setResource] = useState('');
  const resources = useQuery({ queryKey: ['resources', 'all-for-analytics'], queryFn: () => resourceApi.list({ limit: 100 }) });
  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'analytics', range, resource],
    queryFn: () => adminApi.analytics({ ...range, resource }),
  });

  return (
    <div>
      <PageHeader
        title="Analytics"
        description={
          user.role === 'ADMIN'
            ? 'Computed from booking records with MongoDB aggregation.'
            : 'Usage of the resources you are assigned to review.'
        }
      />
      <Card className="mb-6 flex flex-wrap items-end gap-3 p-4">
        <Field label="Period" htmlFor="preset">
          <Select id="preset" value="" onChange={(e) => e.target.value && setRange({ from: campusDate(-(Number(e.target.value) - 1)), to: campusDate() })}>
            <option value="">Quick select…</option>
            {PRESETS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From" htmlFor="from">
          <Input id="from" type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} />
        </Field>
        <Field label="To" htmlFor="to">
          <Input id="to" type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} />
        </Field>
        <Field label="Resource" htmlFor="resource">
          <Select id="resource" value={resource} onChange={(e) => setResource(e.target.value)}>
            <option value="">All resources</option>
            {resources.data?.data.map((r) => (
              <option key={r._id} value={r._id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        {isFetching && !isPending && <span className="pb-2 text-sm text-slate-500">Updating…</span>}
      </Card>

      {isPending ? (
        <Loading label="Calculating analytics…" />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Booking statistics</h2>
          <div className="mb-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Total" value={data.totals.total} />
            <Stat label="Confirmed / upcoming" value={data.totals.confirmed + data.totals.checkedIn} hint={`${data.totals.pending} pending`} />
            <Stat label="Completed" value={data.totals.completed} tone="success" />
            <Stat label="Cancelled" value={data.totals.cancelled} hint={`${data.rates.cancellationRate}% of bookings`} />
            <Stat label="Rejected / expired" value={data.totals.rejected + data.totals.expired} />
            <Stat label="No-shows" value={data.totals.noShows} hint={`${data.rates.noShowRate}% of started bookings`} tone={data.rates.noShowRate > 15 ? 'danger' : undefined} />
          </div>

          <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Utilisation</h2>
          <div className="mb-6 grid gap-4 sm:grid-cols-4">
            <Stat label="Open hours" value={data.utilization.availableHours} hint="From operating hours" />
            <Stat label="Booked hours" value={data.utilization.bookedHours} />
            <Stat label="Utilisation" value={`${data.utilization.utilizationPercent}%`} hint="Booked ÷ open" />
            <Stat label="Actual usage" value={`${data.utilization.usagePercent}%`} hint="Checked-in hours ÷ open" />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="mb-4 font-semibold text-slate-900">Peak hours (bookings occupying each hour)</h3>
              <ColumnChart data={data.peakHours} labelKey="label" valueKey="bookings" ariaLabel="Bookings by hour of day" />
            </Card>
            <Card className="p-5">
              <h3 className="mb-4 font-semibold text-slate-900">Peak days (bookings by weekday)</h3>
              <ColumnChart data={data.peakDays.map((d) => ({ ...d, short: d.day.slice(0, 3) }))} labelKey="short" valueKey="bookings" ariaLabel="Bookings by weekday" />
            </Card>
            <Card className="p-5">
              <h3 className="mb-4 font-semibold text-slate-900">Most used resources (booked hours)</h3>
              <BarList data={data.mostUsedResources} labelKey="name" valueKey="bookedHours" format={(v) => `${v} h`} detail={(d) => `· ${d.bookings} bookings`} />
            </Card>
            <Card className="p-5">
              <h3 className="mb-4 font-semibold text-slate-900">Bookings per day</h3>
              <ColumnChart data={data.trend.map((t) => ({ ...t, day: t.date.slice(5) }))} labelKey="day" valueKey="total" ariaLabel="Bookings per day" />
            </Card>
          </div>

          <Card className="mt-6 overflow-x-auto">
            <div className="px-5 pt-4">
              <h3 className="font-semibold text-slate-900">Utilisation by resource</h3>
            </div>
            <table className="mt-3 w-full min-w-[720px] text-sm">
              <thead className="border-y border-slate-200 bg-slate-50 text-left text-xs text-slate-500 uppercase">
                <tr>
                  {['Resource', 'Bookings', 'Open h', 'Booked h', 'Used h', 'Utilisation', 'No-shows', 'Cancelled'].map((h) => (
                    <th key={h} className="px-5 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.utilization.byResource.map((r) => (
                  <tr key={r.resourceId}>
                    <td className="px-5 py-2 font-medium text-slate-800">{r.name}</td>
                    <td className="px-5 py-2">{r.bookings}</td>
                    <td className="px-5 py-2">{r.availableHours}</td>
                    <td className="px-5 py-2">{r.bookedHours}</td>
                    <td className="px-5 py-2">{r.usedHours}</td>
                    <td className="px-5 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 rounded-full bg-slate-100">
                          <div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${Math.min(100, r.utilizationPercent)}%` }} />
                        </div>
                        {r.utilizationPercent}%
                      </div>
                    </td>
                    <td className="px-5 py-2">{r.noShows}</td>
                    <td className="px-5 py-2">{r.cancelled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <h2 className="mt-8 mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">User behaviour (aggregated)</h2>
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat label="Active bookers" value={data.userBehaviour.activeBookers} />
            <Stat label="Bookings per user" value={data.userBehaviour.bookingsPerUser} hint={`Max by one user: ${data.userBehaviour.maxBookingsByOneUser}`} />
            <Stat label="Cancellation rate" value={`${data.userBehaviour.cancellationRate}%`} />
            <Stat label="No-show rate" value={`${data.userBehaviour.noShowRate}%`} />
          </div>
        </>
      )}
    </div>
  );
}
