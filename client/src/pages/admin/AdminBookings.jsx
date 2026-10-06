import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { adminApi, resourceApi } from '../../api/endpoints.js';
import BookingRow from '../../components/BookingRow.jsx';
import { Card, EmptyState, ErrorState, Field, Input, Loading, PageHeader, Pagination, Select } from '../../components/ui.jsx';
import { BOOKING_STATUS } from '../../utils/status.js';

export default function AdminBookings() {
  const [filters, setFilters] = useState({ search: '', resource: '', status: '', approvalStatus: '', date: '', sort: '-startAt', page: 1 });
  const [search, setSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => (f.search === search ? f : { ...f, search, page: 1 })), 350);
    return () => clearTimeout(id);
  }, [search]);
  const resources = useQuery({ queryKey: ['resources', 'admin-select'], queryFn: () => resourceApi.list({ limit: 100 }) });
  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'bookings', filters],
    queryFn: () => adminApi.bookings({ ...filters, limit: 20 }),
    placeholderData: keepPreviousData,
  });
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value, page: 1 });

  return (
    <div>
      <PageHeader title="All bookings" description="Search and inspect every booking, including cancellations and no-shows." />
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Search" htmlFor="bs" className="lg:col-span-2">
          <Input id="bs" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Code, user name/email, resource, purpose" />
        </Field>
        <Field label="Resource" htmlFor="br">
          <Select id="br" value={filters.resource} onChange={set('resource')}>
            <option value="">All</option>
            {resources.data?.data.map((r) => (
              <option key={r._id} value={r._id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="bst">
          <Select id="bst" value={filters.status} onChange={set('status')}>
            <option value="">All</option>
            {Object.entries(BOOKING_STATUS).map(([v, m]) => (
              <option key={v} value={v}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" htmlFor="bd">
          <Input id="bd" type="date" value={filters.date} onChange={set('date')} />
        </Field>
        <Field label="Sort" htmlFor="bso">
          <Select id="bso" value={filters.sort} onChange={set('sort')}>
            <option value="-startAt">Latest booking time</option>
            <option value="startAt">Earliest booking time</option>
            <option value="createdAt">Recently created</option>
          </Select>
        </Field>
      </Card>
      {isPending ? (
        <Loading label="Loading bookings…" />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : data.data.length === 0 ? (
        <EmptyState title="No bookings match these filters." />
      ) : (
        <>
          <p className="mb-2 text-sm text-slate-500">
            {data.meta.total} booking(s){isFetching ? ' · updating…' : ''}
          </p>
          <Card>
            <ul className="divide-y divide-slate-100">
              {data.data.map((b) => (
                <BookingRow key={b._id} booking={b} showUser />
              ))}
            </ul>
          </Card>
          <Pagination meta={data.meta} onPage={(page) => setFilters({ ...filters, page })} />
        </>
      )}
    </div>
  );
}
