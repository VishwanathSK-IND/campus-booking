import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { resourceApi, userApi } from '../../api/endpoints.js';
import { Alert, Button, Card, ErrorState, Field, Input, Loading, PageHeader, Select, StatusBadge, Textarea } from '../../components/ui.jsx';
import { useToast } from '../../hooks/useToast.jsx';
import { campusDate, CATEGORY_LABELS, DAY_NAMES, formatClock, formatDate } from '../../utils/format.js';
import { RESOURCE_STATUS } from '../../utils/status.js';
import { StatusDialog } from './AdminResources.jsx';

const ROLES = ['STUDENT', 'FACULTY', 'ADMIN'];
const DEFAULT_RULES = {
  slotMinutes: 30,
  minDurationMinutes: 30,
  maxDurationMinutes: 120,
  maxAdvanceDays: 14,
  maxActiveBookingsPerUser: 2,
  allowedRoles: ['STUDENT', 'FACULTY', 'ADMIN'],
  approvalRequired: false,
  approvalExemptRoles: ['ADMIN'],
  facultyPriority: false,
  cancellationDeadlineMinutes: 60,
  checkInOpensBeforeMinutes: 15,
  checkInGraceMinutes: 15,
};
const EMPTY = {
  name: '',
  description: '',
  category: 'LAB',
  location: '',
  capacity: 0,
  facilities: '',
  hours: DAY_NAMES.map((_, day) => ({ day, enabled: day >= 1 && day <= 6, open: '08:00', close: '20:00' })),
  bookingRules: DEFAULT_RULES,
  approvers: [],
};

function toForm(r) {
  return {
    name: r.name,
    description: r.description || '',
    category: r.category,
    location: r.location,
    capacity: r.capacity || 0,
    facilities: r.facilities.join(', '),
    hours: DAY_NAMES.map((_, day) => {
      const h = r.operatingHours.find((x) => x.day === day);
      return { day, enabled: Boolean(h), open: h?.open || '08:00', close: h?.close || '20:00' };
    }),
    bookingRules: { ...DEFAULT_RULES, ...r.bookingRules },
    approvers: (r.approvers || []).map((a) => a._id || a),
  };
}

function RoleChecks({ value, onChange, label }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-slate-700">{label}</legend>
      <div className="flex gap-4">
        {ROLES.map((role) => (
          <label key={role} className="flex items-center gap-1.5 text-sm capitalize">
            <input type="checkbox" checked={value.includes(role)} onChange={(e) => onChange(e.target.checked ? [...value, role] : value.filter((r) => r !== role))} />
            {role.toLowerCase()}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function BlockedPeriods({ resource }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ date: campusDate(1), startTime: '09:00', endTime: '12:00', reason: '' });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['resource', resource._id] });
  const add = useMutation({
    mutationFn: () => resourceApi.addBlock(resource._id, form),
    onSuccess: (res) => (toast.success(res.message), refresh(), setForm({ ...form, reason: '' })),
  });
  const remove = useMutation({ mutationFn: (id) => resourceApi.removeBlock(resource._id, id), onSuccess: (res) => (toast.success(res.message), refresh()) });
  const upcoming = resource.blockedPeriods.filter((b) => new Date(b.endAt) > new Date());
  return (
    <Card className="p-5">
      <h2 className="font-semibold text-slate-900">Blocked periods</h2>
      <p className="mb-4 text-sm text-slate-500">Reserve time for exams, events or scheduled maintenance. Blocks cannot overlap existing bookings.</p>
      {upcoming.length > 0 && (
        <ul className="mb-4 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
          {upcoming.map((b) => (
            <li key={b._id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                {formatDate(b.date)} · {formatClock(b.startTime)}–{formatClock(b.endTime)} · {b.reason}
              </span>
              <Button variant="ghost" size="sm" loading={remove.isPending && remove.variables === b._id} onClick={() => remove.mutate(b._id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-5">
        <Field label="Date" htmlFor="bd">
          <Input id="bd" type="date" min={campusDate()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field label="From" htmlFor="bs">
          <Input id="bs" type="time" step="900" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
        </Field>
        <Field label="To" htmlFor="be">
          <Input id="be" type="time" step="900" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
        </Field>
        <Field label="Reason" htmlFor="br" className="sm:col-span-2">
          <Input id="br" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Semester lab exam" />
        </Field>
      </div>
      {add.isError && (
        <Alert className="mt-3">
          {add.error.message}
          {add.error.details?.length > 0 && <ul className="mt-1 list-inside list-disc">{add.error.details.map((d) => <li key={d.code || d.field}>{d.code ? `${d.code} (${d.time}, ${d.status})` : d.message}</li>)}</ul>}
        </Alert>
      )}
      <Button className="mt-3" variant="secondary" loading={add.isPending} loadingText="Adding…" disabled={form.reason.trim().length < 3} onClick={() => add.mutate()}>
        Add blocked period
      </Button>
    </Card>
  );
}

export default function AdminResourceForm() {
  const { resourceId } = useParams();
  const editing = Boolean(resourceId);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [statusOpen, setStatusOpen] = useState(false);
  const resource = useQuery({ queryKey: ['resource', resourceId], queryFn: () => resourceApi.get(resourceId), enabled: editing });
  const approvers = useQuery({ queryKey: ['approvers'], queryFn: userApi.approvers });

  useEffect(() => {
    if (resource.data) setForm(toForm(resource.data));
  }, [resource.data]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        description: form.description,
        category: form.category,
        location: form.location,
        capacity: Number(form.capacity) || 0,
        facilities: form.facilities.split(',').map((f) => f.trim()).filter(Boolean),
        operatingHours: form.hours.filter((h) => h.enabled).map(({ day, open, close }) => ({ day, open, close })),
        bookingRules: Object.fromEntries(Object.entries(form.bookingRules).map(([k, v]) => [k, typeof DEFAULT_RULES[k] === 'number' ? Number(v) : v])),
        approvers: form.approvers,
      };
      return editing ? resourceApi.update(resourceId, body) : resourceApi.create(body);
    },
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ['resources'] });
      queryClient.invalidateQueries({ queryKey: ['resource', res.data._id] });
      navigate(editing ? `/resources/${res.data._id}` : `/admin/resources/${res.data._id}/edit`);
    },
  });

  if (editing && resource.isPending) return <Loading label="Loading resource…" />;
  if (editing && resource.isError) return <ErrorState error={resource.error} onRetry={resource.refetch} />;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const rule = (key) => (e) => setForm({ ...form, bookingRules: { ...form.bookingRules, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } });
  const setRule = (key, value) => setForm({ ...form, bookingRules: { ...form.bookingRules, [key]: value } });
  const setHour = (day, changes) => setForm({ ...form, hours: form.hours.map((h) => (h.day === day ? { ...h, ...changes } : h)) });
  const r = form.bookingRules;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        back={{ to: '/admin/resources', label: 'Resources' }}
        title={editing ? `Edit ${resource.data.name}` : 'Add resource'}
        actions={
          editing && (
            <>
              <StatusBadge map={RESOURCE_STATUS} status={resource.data.status} />
              <Button variant="secondary" onClick={() => setStatusOpen(true)}>
                Change status
              </Button>
            </>
          )
        }
      />
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="font-semibold text-slate-900 sm:col-span-2">Details</h2>
          <Field label="Name" htmlFor="name">
            <Input id="name" required value={form.name} onChange={set('name')} />
          </Field>
          <Field label="Category" htmlFor="category">
            <Select id="category" value={form.category} onChange={set('category')}>
              {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Location" htmlFor="location">
            <Input id="location" required value={form.location} onChange={set('location')} placeholder="e.g. Block A, 2nd Floor" />
          </Field>
          <Field label="Capacity" htmlFor="capacity" hint="0 for equipment">
            <Input id="capacity" type="number" min="0" value={form.capacity} onChange={set('capacity')} />
          </Field>
          <Field label="Description" htmlFor="description" className="sm:col-span-2">
            <Textarea id="description" rows={3} value={form.description} onChange={set('description')} />
          </Field>
          <Field label="Facilities" htmlFor="facilities" hint="Comma-separated" className="sm:col-span-2">
            <Input id="facilities" value={form.facilities} onChange={set('facilities')} placeholder="Projector, Air conditioning, Whiteboard" />
          </Field>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-semibold text-slate-900">Operating hours (campus time)</h2>
          <div className="space-y-2">
            {form.hours.map((h) => (
              <div key={h.day} className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex w-32 items-center gap-2">
                  <input type="checkbox" checked={h.enabled} onChange={(e) => setHour(h.day, { enabled: e.target.checked })} />
                  {DAY_NAMES[h.day]}
                </label>
                {h.enabled ? (
                  <>
                    <Input aria-label={`${DAY_NAMES[h.day]} opens`} type="time" step="900" className="w-32" value={h.open} onChange={(e) => setHour(h.day, { open: e.target.value })} />
                    <span>to</span>
                    <Input
                      aria-label={`${DAY_NAMES[h.day]} closes`}
                      type="text"
                      pattern="([01]\d|2[0-3]):[0-5]\d|24:00"
                      className="w-32"
                      value={h.close}
                      onChange={(e) => setHour(h.day, { close: e.target.value })}
                      title="HH:mm, use 24:00 for midnight"
                    />
                  </>
                ) : (
                  <span className="text-slate-400">Closed</span>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card className="grid gap-4 p-5 sm:grid-cols-3">
          <h2 className="font-semibold text-slate-900 sm:col-span-3">Booking rules</h2>
          <Field label="Slot length" htmlFor="slot">
            <Select id="slot" value={r.slotMinutes} onChange={rule('slotMinutes')}>
              {[15, 30, 60].map((v) => (
                <option key={v} value={v}>
                  {v} minutes
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Min duration (min)" htmlFor="min">
            <Input id="min" type="number" step={r.slotMinutes} min={r.slotMinutes} value={r.minDurationMinutes} onChange={rule('minDurationMinutes')} />
          </Field>
          <Field label="Max duration (min)" htmlFor="max">
            <Input id="max" type="number" step={r.slotMinutes} min={r.slotMinutes} value={r.maxDurationMinutes} onChange={rule('maxDurationMinutes')} />
          </Field>
          <Field label="Book up to (days ahead)" htmlFor="adv">
            <Input id="adv" type="number" min="0" value={r.maxAdvanceDays} onChange={rule('maxAdvanceDays')} />
          </Field>
          <Field label="Active bookings per user" htmlFor="per">
            <Input id="per" type="number" min="1" value={r.maxActiveBookingsPerUser} onChange={rule('maxActiveBookingsPerUser')} />
          </Field>
          <Field label="Cancellation deadline (min before)" htmlFor="cd">
            <Input id="cd" type="number" min="0" value={r.cancellationDeadlineMinutes} onChange={rule('cancellationDeadlineMinutes')} />
          </Field>
          <Field label="Check-in opens (min before start)" htmlFor="co">
            <Input id="co" type="number" min="0" value={r.checkInOpensBeforeMinutes} onChange={rule('checkInOpensBeforeMinutes')} />
          </Field>
          <Field label="Check-in grace (min after start)" htmlFor="cg" hint="After this, the booking becomes a no-show">
            <Input id="cg" type="number" min="1" value={r.checkInGraceMinutes} onChange={rule('checkInGraceMinutes')} />
          </Field>
          <div />
          <div className="sm:col-span-3">
            <RoleChecks label="Who can book" value={r.allowedRoles} onChange={(v) => setRule('allowedRoles', v)} />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input type="checkbox" checked={r.approvalRequired} onChange={rule('approvalRequired')} /> Bookings require approval
          </label>
          {r.approvalRequired && (
            <div className="sm:col-span-3">
              <RoleChecks label="Roles exempt from approval" value={r.approvalExemptRoles} onChange={(v) => setRule('approvalExemptRoles', v)} />
            </div>
          )}
          <label className="flex items-start gap-2 text-sm sm:col-span-3">
            <input type="checkbox" className="mt-1" checked={r.facultyPriority} onChange={rule('facultyPriority')} />
            <span>
              Faculty priority — faculty requests rank ahead of student requests in the approval queue and waitlist. Never cancels existing bookings.
            </span>
          </label>
          <Field label="Approvers (faculty who review requests and can show the check-in kiosk)" htmlFor="appr" className="sm:col-span-3" hint="If none, requests go to all admins. Ctrl/Cmd-click to select several.">
            <Select id="appr" multiple className="h-28" value={form.approvers} onChange={(e) => setForm({ ...form, approvers: [...e.target.selectedOptions].map((o) => o.value) })}>
              {approvers.data?.map((a) => (
                <option key={a._id} value={a._id}>
                  {a.name} · {a.role.toLowerCase()} · {a.email}
                </option>
              ))}
            </Select>
          </Field>
        </Card>

        {save.isError && (
          <Alert>
            {save.error.message}
            {save.error.details?.length > 1 && (
              <ul className="mt-1 list-inside list-disc">
                {save.error.details.map((d, i) => (
                  <li key={i}>
                    {d.field}: {d.message}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending} loadingText="Saving…">
            {editing ? 'Save changes' : 'Create resource'}
          </Button>
        </div>
      </form>

      {editing && <BlockedPeriods resource={resource.data} />}
      {statusOpen && <StatusDialog resource={resource.data} onClose={() => setStatusOpen(false)} />}
    </div>
  );
}
