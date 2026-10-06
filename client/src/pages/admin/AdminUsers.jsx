import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { adminApi } from '../../api/endpoints.js';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, PageHeader, Pagination, Select, Textarea } from '../../components/ui.jsx';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useToast } from '../../hooks/useToast.jsx';
import { formatDate, formatDateTime } from '../../utils/format.js';
import { BOOKING_STATUS } from '../../utils/status.js';

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'user'] });
  };
}

function CreateUserDialog({ onClose }) {
  const toast = useToast();
  const invalidate = useInvalidateUsers();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'FACULTY', department: '' });
  const mutation = useMutation({
    mutationFn: () => adminApi.createUser({ ...form, department: form.department || undefined }),
    onSuccess: (res) => (toast.success(res.message), invalidate(), onClose()),
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal
      open
      onClose={onClose}
      title="Create account"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={mutation.isPending} loadingText="Creating…" onClick={() => mutation.mutate()}>
            Create account
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="cu-name">
          <Input id="cu-name" value={form.name} onChange={set('name')} />
        </Field>
        <Field label="Email" htmlFor="cu-email">
          <Input id="cu-email" type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Role" htmlFor="cu-role">
          <Select id="cu-role" value={form.role} onChange={set('role')}>
            <option value="FACULTY">Faculty</option>
            <option value="ADMIN">Admin</option>
            <option value="STUDENT">Student</option>
          </Select>
        </Field>
        <Field label="Department" htmlFor="cu-dept">
          <Input id="cu-dept" value={form.department} onChange={set('department')} />
        </Field>
        <Field label="Initial password" htmlFor="cu-pw" hint="8+ characters with a letter and a number. Share it securely." className="sm:col-span-2">
          <Input id="cu-pw" type="text" value={form.password} onChange={set('password')} />
        </Field>
      </div>
      {mutation.isError && <Alert className="mt-3">{mutation.error.message}</Alert>}
    </Modal>
  );
}

function UserDialog({ userId, onClose }) {
  const { user: me } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateUsers();
  const { data, isPending, isError, error } = useQuery({ queryKey: ['admin', 'user', userId], queryFn: () => adminApi.user(userId) });
  const [restrict, setRestrict] = useState({ days: 3, reason: '' });
  const onDone = (res) => (toast.success(res.message), invalidate());
  const update = useMutation({ mutationFn: (body) => adminApi.updateUser(userId, body), onSuccess: onDone, onError: (e) => toast.error(e.message) });
  const addRestriction = useMutation({
    mutationFn: () => adminApi.restrict(userId, { days: Number(restrict.days), reason: restrict.reason }),
    onSuccess: (res) => (onDone(res), setRestrict({ days: 3, reason: '' })),
  });
  const lift = useMutation({ mutationFn: (id) => adminApi.liftRestriction(id, { reason: 'Lifted by administrator' }), onSuccess: onDone, onError: (e) => toast.error(e.message) });

  return (
    <Modal open onClose={onClose} title="User details" size="lg">
      {isPending ? (
        <Loading />
      ) : isError ? (
        <ErrorState error={error} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-slate-900">{data.user.name}</p>
              <p className="text-sm text-slate-500">
                {data.user.email} · {data.user.department || 'No department'} · joined {formatDate(data.user.createdAt)}
              </p>
            </div>
            {!data.user.isActive && <Badge tone="gray">Deactivated</Badge>}
          </div>

          {String(data.user._id) !== String(me._id) && (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Role" htmlFor="ud-role">
                <Select id="ud-role" value={data.user.role} onChange={(e) => update.mutate({ role: e.target.value })} disabled={update.isPending}>
                  <option value="STUDENT">Student</option>
                  <option value="FACULTY">Faculty</option>
                  <option value="ADMIN">Admin</option>
                </Select>
              </Field>
              <Button variant={data.user.isActive ? 'secondary' : 'success'} loading={update.isPending} onClick={() => update.mutate({ isActive: !data.user.isActive })}>
                {data.user.isActive ? 'Deactivate account' : 'Reactivate account'}
              </Button>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Bookings by status</h3>
            <div className="flex flex-wrap gap-2 text-sm">
              {Object.keys(data.bookingStats).length === 0 && <span className="text-slate-500">No bookings.</span>}
              {Object.entries(data.bookingStats).map(([status, count]) => (
                <Badge key={status} tone={BOOKING_STATUS[status]?.tone}>
                  {BOOKING_STATUS[status]?.label}: {count}
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Restrictions</h3>
            {data.restrictions.length === 0 ? (
              <p className="text-sm text-slate-500">No restrictions.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg text-sm ring-1 ring-slate-200">
                {data.restrictions.map((r) => (
                  <li key={r._id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div>
                      <p className="text-slate-800">
                        {r.active ? <Badge tone="red">Active</Badge> : <Badge tone="gray">{r.liftedAt ? 'Lifted' : 'Ended'}</Badge>} {r.reason}
                      </p>
                      <p className="text-xs text-slate-500">
                        {r.source === 'NO_SHOW' ? 'Automatic (no-show policy)' : 'Applied by admin'} · {formatDateTime(r.startsAt)} → {formatDateTime(r.endsAt)}
                      </p>
                    </div>
                    {r.active && (
                      <Button size="sm" variant="secondary" loading={lift.isPending && lift.variables === r._id} onClick={() => lift.mutate(r._id)}>
                        Lift
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {data.user.role !== 'ADMIN' && (
              <div className="mt-3 grid gap-2 sm:grid-cols-[6rem_1fr_auto] sm:items-end">
                <Field label="Days" htmlFor="rd">
                  <Input id="rd" type="number" min="1" max="365" value={restrict.days} onChange={(e) => setRestrict({ ...restrict, days: e.target.value })} />
                </Field>
                <Field label="Reason" htmlFor="rr">
                  <Textarea id="rr" rows={1} value={restrict.reason} onChange={(e) => setRestrict({ ...restrict, reason: e.target.value })} />
                </Field>
                <Button variant="danger" loading={addRestriction.isPending} disabled={restrict.reason.trim().length < 3} onClick={() => addRestriction.mutate()}>
                  Restrict
                </Button>
              </div>
            )}
            {addRestriction.isError && <Alert className="mt-2">{addRestriction.error.message}</Alert>}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">No-show history</h3>
            {data.noShows.length === 0 ? (
              <p className="text-sm text-slate-500">No no-shows.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.noShows.map((n) => (
                  <li key={n._id}>
                    <Link to={`/bookings/${n.booking?._id}`} className="text-brand-700 hover:underline">
                      {n.booking?.code}
                    </Link>{' '}
                    · {n.booking?.resourceSnapshot?.name} · {formatDate(n.booking?.date)} · #{n.countInWindow} in window → {n.penaltyApplied.toLowerCase()}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function AdminUsers() {
  const [params] = useSearchParams();
  const [filters, setFilters] = useState({ search: '', role: '', restricted: params.get('restricted') || '', page: 1 });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => (f.search === search ? f : { ...f, search, page: 1 })), 350);
    return () => clearTimeout(id);
  }, [search]);
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'users', filters],
    queryFn: () => adminApi.users({ ...filters, limit: 20 }),
    placeholderData: keepPreviousData,
  });
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value, page: 1 });

  return (
    <div>
      <PageHeader title="Users" description="Manage roles, account status and booking restrictions." actions={<Button onClick={() => setCreating(true)}>Create account</Button>} />
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-3">
        <Field label="Search" htmlFor="us">
          <Input id="us" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email, department" />
        </Field>
        <Field label="Role" htmlFor="ur">
          <Select id="ur" value={filters.role} onChange={set('role')}>
            <option value="">All roles</option>
            <option value="STUDENT">Student</option>
            <option value="FACULTY">Faculty</option>
            <option value="ADMIN">Admin</option>
          </Select>
        </Field>
        <Field label="Restriction" htmlFor="urs">
          <Select id="urs" value={filters.restricted} onChange={set('restricted')}>
            <option value="">Any</option>
            <option value="true">Currently restricted</option>
            <option value="false">Not restricted</option>
          </Select>
        </Field>
      </Card>
      {isPending ? (
        <Loading label="Loading users…" />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : data.data.length === 0 ? (
        <EmptyState title="No users match these filters." />
      ) : (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 uppercase">
                <tr>
                  {['Name', 'Role', 'Department', 'No-shows (window)', 'Status', ''].map((h) => (
                    <th key={h} className="px-4 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.data.map((u) => (
                  <tr key={u._id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{u.name}</p>
                      <p className="text-xs text-slate-500">{u.email}</p>
                    </td>
                    <td className="px-4 py-3 capitalize">{u.role.toLowerCase()}</td>
                    <td className="px-4 py-3">{u.department || '—'}</td>
                    <td className="px-4 py-3">{u.recentNoShows}</td>
                    <td className="px-4 py-3">
                      {!u.isActive ? (
                        <Badge tone="gray">Deactivated</Badge>
                      ) : u.activeRestriction ? (
                        <Badge tone="red" symbol="!">
                          Restricted until {formatDate(u.activeRestriction.endsAt, { day: 'numeric', month: 'short' })}
                        </Badge>
                      ) : (
                        <Badge tone="green" symbol="✓">
                          Good standing
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="secondary" size="sm" onClick={() => setSelected(u._id)}>
                        Manage
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Pagination meta={data.meta} onPage={(page) => setFilters({ ...filters, page })} />
        </>
      )}
      {selected && <UserDialog userId={selected} onClose={() => setSelected(null)} />}
      {creating && <CreateUserDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
