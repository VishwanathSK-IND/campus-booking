import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { adminApi } from '../../api/endpoints.js';
import { Badge, Card, EmptyState, ErrorState, Field, Loading, PageHeader, Pagination, Select } from '../../components/ui.jsx';
import { formatDateTime } from '../../utils/format.js';

const ACTIONS = [
  'RESOURCE_CREATED',
  'RESOURCE_UPDATED',
  'RESOURCE_POLICY_UPDATED',
  'RESOURCE_STATUS_CHANGED',
  'RESOURCE_BLOCK_ADDED',
  'RESOURCE_BLOCK_REMOVED',
  'BOOKING_APPROVED',
  'BOOKING_REJECTED',
  'BOOKING_CANCELLED',
  'NO_SHOW_RECORDED',
  'NO_SHOW_RESTRICTION',
  'RESTRICTION_APPLIED',
  'RESTRICTION_LIFTED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_ROLE_CHANGED',
  'POLICY_UPDATED',
];

export default function AdminAudit() {
  const [filters, setFilters] = useState({ action: '', entityType: '', page: 1 });
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'audit', filters],
    queryFn: () => adminApi.auditLogs({ ...filters, limit: 25 }),
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <PageHeader title="Audit log" description="Append-only record of administrative and automated actions." />
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2">
        <Field label="Action" htmlFor="aa">
          <Select id="aa" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value, page: 1 })}>
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a.replaceAll('_', ' ').toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Entity" htmlFor="ae">
          <Select id="ae" value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value, page: 1 })}>
            <option value="">All</option>
            <option value="Resource">Resource</option>
            <option value="Booking">Booking</option>
            <option value="User">User</option>
            <option value="SystemPolicy">Policy</option>
          </Select>
        </Field>
      </Card>
      {isPending ? (
        <Loading />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : data.data.length === 0 ? (
        <EmptyState title="No audit entries." />
      ) : (
        <>
          <Card>
            <ul className="divide-y divide-slate-100">
              {data.data.map((entry) => (
                <li key={entry._id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-slate-800">{entry.summary}</p>
                    <p className="text-xs text-slate-500">
                      {entry.actorSnapshot?.name} ({entry.actorSnapshot?.role?.toLowerCase()}) · {formatDateTime(entry.createdAt)}
                    </p>
                  </div>
                  <Badge tone={entry.actorSnapshot?.role === 'SYSTEM' ? 'violet' : 'slate'}>{entry.action.replaceAll('_', ' ').toLowerCase()}</Badge>
                </li>
              ))}
            </ul>
          </Card>
          <Pagination meta={data.meta} onPage={(page) => setFilters({ ...filters, page })} />
        </>
      )}
    </div>
  );
}
