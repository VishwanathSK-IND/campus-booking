import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { resourceApi } from '../api/endpoints.js';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, PageHeader, Pagination, Select, StatusBadge } from '../components/ui.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { campusDate, CATEGORY_LABELS, formatClock } from '../utils/format.js';
import { RESOURCE_STATUS } from '../utils/status.js';

const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

export default function Resources() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') || '');
  const filters = Object.fromEntries(params.entries());

  // Debounce the search box into the URL (the URL is the single source of filter state).
  useEffect(() => {
    const id = setTimeout(() => {
      if ((params.get('search') || '') !== search) update({ search });
    }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function update(changes) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  }

  const availabilityFilter = Boolean(filters.date && filters.startTime && filters.endTime);
  const query = {
    search: filters.search,
    category: filters.category,
    location: filters.location,
    status: filters.status,
    sort: filters.sort || 'name',
    page: filters.page || 1,
    limit: 12,
    ...(availabilityFilter ? { date: filters.date, startTime: filters.startTime, endTime: filters.endTime } : {}),
  };
  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['resources', query],
    queryFn: () => resourceApi.list(query),
    placeholderData: keepPreviousData,
  });
  const { data: locations = [] } = useQuery({ queryKey: ['resources', 'locations'], queryFn: resourceApi.locations, staleTime: 300_000 });

  const hasFilters = ['search', 'category', 'location', 'status', 'date'].some((k) => filters[k]);

  return (
    <div>
      <PageHeader title="Resources" description="Find labs, halls, courts and equipment, then check live availability." />

      <Card className="mb-6 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Search" htmlFor="search" className="lg:col-span-2">
            <Input id="search" type="search" placeholder="e.g. computer lab, projector" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <Field label="Category" htmlFor="category">
            <Select id="category" value={filters.category || ''} onChange={(e) => update({ category: e.target.value })}>
              <option value="">All categories</option>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Location" htmlFor="location">
            <Select id="location" value={filters.location || ''} onChange={(e) => update({ location: e.target.value })}>
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sort by" htmlFor="sort">
            <Select id="sort" value={filters.sort || 'name'} onChange={(e) => update({ sort: e.target.value })}>
              <option value="name">Name (A–Z)</option>
              <option value="-name">Name (Z–A)</option>
              <option value="-capacity">Largest capacity</option>
              <option value="capacity">Smallest capacity</option>
              <option value="-createdAt">Newest</option>
            </Select>
          </Field>
        </div>
        <details className="mt-3" open={availabilityFilter || undefined}>
          <summary className="cursor-pointer text-sm font-medium text-brand-700">Only show resources free at a specific time</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Field label="Date" htmlFor="f-date">
              <Input id="f-date" type="date" min={campusDate()} value={filters.date || ''} onChange={(e) => update({ date: e.target.value })} />
            </Field>
            <Field label="From" htmlFor="f-start">
              <Select id="f-start" value={filters.startTime || ''} onChange={(e) => update({ startTime: e.target.value })}>
                <option value="">—</option>
                {TIMES.map((t) => (
                  <option key={t} value={t}>
                    {formatClock(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="To" htmlFor="f-end">
              <Select id="f-end" value={filters.endTime || ''} onChange={(e) => update({ endTime: e.target.value })}>
                <option value="">—</option>
                {[...TIMES.slice(1), '24:00'].map((t) => (
                  <option key={t} value={t}>
                    {formatClock(t)}
                  </option>
                ))}
              </Select>
            </Field>
            {user.role === 'ADMIN' && (
              <Field label="Status" htmlFor="f-status">
                <Select id="f-status" value={filters.status || ''} onChange={(e) => update({ status: e.target.value })}>
                  <option value="">Active + maintenance</option>
                  <option value="ACTIVE">Active</option>
                  <option value="MAINTENANCE">Maintenance</option>
                  <option value="INACTIVE">Inactive</option>
                </Select>
              </Field>
            )}
          </div>
          {(filters.date || filters.startTime || filters.endTime) && !availabilityFilter && (
            <p className="mt-2 text-xs text-amber-700">Choose a date, start and end time to filter by availability.</p>
          )}
        </details>
      </Card>

      {isPending ? (
        <Loading label="Loading resources…" />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : data.data.length === 0 ? (
        <EmptyState
          title="No resources found."
          description={hasFilters ? 'Try changing your filters or search term.' : 'No resources have been added yet.'}
          action={
            hasFilters && (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setParams({}, { replace: true });
                }}
              >
                Clear filters
              </Button>
            )
          }
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-500" aria-live="polite">
            {data.meta.total} resource{data.meta.total === 1 ? '' : 's'}
            {availabilityFilter && ` free on ${filters.date}, ${formatClock(filters.startTime)}–${formatClock(filters.endTime)}`}
            {isFetching && ' · updating…'}
          </p>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.data.map((r) => (
              <li key={r._id}>
                <Link to={`/resources/${r._id}${availabilityFilter ? `?date=${filters.date}` : ''}`} className="block h-full rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md hover:ring-brand-300">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-semibold text-slate-900">{r.name}</h2>
                    <StatusBadge map={RESOURCE_STATUS} status={r.status} />
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {CATEGORY_LABELS[r.category]} · {r.location}
                    {r.capacity > 0 && ` · ${r.capacity} seats`}
                  </p>
                  <p className="mt-3 line-clamp-2 text-sm text-slate-600">{r.description}</p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {r.bookingRules.approvalRequired && <Badge tone="amber">Approval required</Badge>}
                    {r.bookingRules.facultyPriority && <Badge tone="violet">Faculty priority</Badge>}
                    <Badge tone="slate">Up to {r.bookingRules.maxDurationMinutes / 60} h</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination meta={data.meta} onPage={(page) => update({ page: String(page) })} />
        </>
      )}
    </div>
  );
}
