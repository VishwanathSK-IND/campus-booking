import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { resourceApi } from '../../api/endpoints.js';
import { Alert, Button, ButtonLink, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, PageHeader, Pagination, Select, StatusBadge, Textarea } from '../../components/ui.jsx';
import { useToast } from '../../hooks/useToast.jsx';
import { CATEGORY_LABELS } from '../../utils/format.js';
import { RESOURCE_STATUS } from '../../utils/status.js';

export function StatusDialog({ resource, onClose }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ status: resource.status === 'ACTIVE' ? 'MAINTENANCE' : 'ACTIVE', reason: '', cancelExistingBookings: false });
  const mutation = useMutation({
    mutationFn: () => resourceApi.setStatus(resource._id, { ...form, reason: form.reason || undefined }),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ['resources'] });
      queryClient.invalidateQueries({ queryKey: ['resource', resource._id] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Change status · ${resource.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={mutation.isPending} loadingText="Saving…" disabled={form.status === resource.status} onClick={() => mutation.mutate()}>
            Save status
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="New status" htmlFor="st">
          <Select id="st" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="ACTIVE">Active — bookable</option>
            <option value="MAINTENANCE">Maintenance — new bookings blocked</option>
            <option value="INACTIVE">Inactive — hidden from users, history kept</option>
          </Select>
        </Field>
        <Field label="Reason (shown to users)" htmlFor="sr">
          <Textarea id="sr" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </Field>
        {form.status !== 'ACTIVE' && (
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-1" checked={form.cancelExistingBookings} onChange={(e) => setForm({ ...form, cancelExistingBookings: e.target.checked })} />
            <span>
              Cancel all upcoming bookings for this resource. Each user is notified with the reason and the cancellation is audited. If unchecked, existing
              bookings are kept and users are informed.
            </span>
          </label>
        )}
        {mutation.isError && <Alert>{mutation.error.message}</Alert>}
      </div>
    </Modal>
  );
}

export default function AdminResources() {
  const [filters, setFilters] = useState({ search: '', status: '', category: '', page: 1 });
  const [statusFor, setStatusFor] = useState(null);
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['resources', 'admin', filters],
    queryFn: () => resourceApi.list({ ...filters, limit: 15 }),
    placeholderData: keepPreviousData,
  });
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value, page: 1 });

  return (
    <div>
      <PageHeader title="Manage resources" description="Create resources, configure rules and operating hours, and control availability." actions={<ButtonLink to="/admin/resources/new">Add resource</ButtonLink>} />
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-3">
        <Field label="Search" htmlFor="rs">
          <Input id="rs" type="search" value={filters.search} onChange={set('search')} placeholder="Name, location…" />
        </Field>
        <Field label="Status" htmlFor="rst">
          <Select id="rst" value={filters.status} onChange={set('status')}>
            <option value="">Active + maintenance</option>
            <option value="ACTIVE">Active</option>
            <option value="MAINTENANCE">Maintenance</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
        </Field>
        <Field label="Category" htmlFor="rc">
          <Select id="rc" value={filters.category} onChange={set('category')}>
            <option value="">All</option>
            {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
      </Card>
      {isPending ? (
        <Loading label="Loading resources…" />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : data.data.length === 0 ? (
        <EmptyState title="No resources found." action={<ButtonLink to="/admin/resources/new">Add resource</ButtonLink>} />
      ) : (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 uppercase">
                <tr>
                  {['Resource', 'Category', 'Location', 'Rules', 'Status', ''].map((h) => (
                    <th key={h} className="px-4 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.data.map((r) => (
                  <tr key={r._id}>
                    <td className="px-4 py-3">
                      <Link to={`/resources/${r._id}`} className="font-medium text-slate-900 hover:text-brand-700">
                        {r.name}
                      </Link>
                      {r.capacity > 0 && <p className="text-xs text-slate-500">{r.capacity} seats</p>}
                    </td>
                    <td className="px-4 py-3">{CATEGORY_LABELS[r.category]}</td>
                    <td className="px-4 py-3">{r.location}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      ≤ {r.bookingRules.maxDurationMinutes / 60} h · {r.bookingRules.maxAdvanceDays} days ahead
                      {r.bookingRules.approvalRequired && ' · approval'}
                      {r.bookingRules.facultyPriority && ' · faculty priority'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge map={RESOURCE_STATUS} status={r.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <ButtonLink to={`/admin/resources/${r._id}/edit`} variant="secondary" size="sm">
                          Edit
                        </ButtonLink>
                        <Button variant="secondary" size="sm" onClick={() => setStatusFor(r)}>
                          Status
                        </Button>                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Pagination meta={data.meta} onPage={(page) => setFilters({ ...filters, page })} />
        </>
      )}
      {statusFor && <StatusDialog resource={statusFor} onClose={() => setStatusFor(null)} />}
    </div>
  );
}
