import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { adminApi } from '../../api/endpoints.js';
import { Alert, Button, Card, ErrorState, Field, Input, Loading, PageHeader, Select } from '../../components/ui.jsx';
import { useToast } from '../../hooks/useToast.jsx';

export default function AdminPolicy() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: ['admin', 'policy'], queryFn: adminApi.policy });
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (data) setForm(structuredClone(data));
  }, [data]);

  const save = useMutation({
    mutationFn: () => {
      const n = (v) => Number(v);
      return adminApi.savePolicy({
        maxActiveBookingsByRole: { STUDENT: n(form.maxActiveBookingsByRole.STUDENT), FACULTY: n(form.maxActiveBookingsByRole.FACULTY), ADMIN: n(form.maxActiveBookingsByRole.ADMIN) },
        noShow: {
          lookbackDays: n(form.noShow.lookbackDays),
          tiers: form.noShow.tiers.map((t) => ({ threshold: n(t.threshold), action: t.action, restrictionDays: t.action === 'WARNING' ? 0 : n(t.restrictionDays) })),
        },
        waitlist: { offerMinutes: n(form.waitlist.offerMinutes), maxEntriesPerUser: n(form.waitlist.maxEntriesPerUser) },
        reminders: { enabled: form.reminders.enabled, leadMinutes: n(form.reminders.leadMinutes), checkInLeadMinutes: n(form.reminders.checkInLeadMinutes) },
      });
    },
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.setQueryData(['admin', 'policy'], res.data);
    },
  });

  if (isPending || !form) return isError ? <ErrorState error={error} onRetry={refetch} /> : <Loading />;

  const setPath = (path, value) => {
    const next = structuredClone(form);
    let target = next;
    for (const key of path.slice(0, -1)) target = target[key];
    target[path[path.length - 1]] = value;
    setForm(next);
  };
  const num = (path) => ({ type: 'number', min: 0, value: path.reduce((o, k) => o[k], form), onChange: (e) => setPath(path, e.target.value) });

  return (
    <form
      className="mx-auto max-w-3xl space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <PageHeader title="Campus booking policy" description="Campus-wide rules. Resource-specific rules are configured on each resource. All changes are audited." />
      <Card className="grid gap-4 p-5 sm:grid-cols-3">
        <h2 className="font-semibold text-slate-900 sm:col-span-3">Maximum active bookings per user</h2>
        {['STUDENT', 'FACULTY', 'ADMIN'].map((role) => (
          <Field key={role} label={role.charAt(0) + role.slice(1).toLowerCase()} htmlFor={`m-${role}`}>
            <Input id={`m-${role}`} {...num(['maxActiveBookingsByRole', role])} min={1} />
          </Field>
        ))}
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-semibold text-slate-900">No-show escalation</h2>
        <Field label="Look-back window (days)" htmlFor="lb" className="max-w-xs">
          <Input id="lb" {...num(['noShow', 'lookbackDays'])} min={1} />
        </Field>
        {form.noShow.tiers.map((tier, i) => (
          <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <Field label="At no-show #" htmlFor={`t-${i}`}>
              <Input id={`t-${i}`} {...num(['noShow', 'tiers', i, 'threshold'])} min={1} />
            </Field>
            <Field label="Action" htmlFor={`a-${i}`}>
              <Select id={`a-${i}`} value={tier.action} onChange={(e) => setPath(['noShow', 'tiers', i, 'action'], e.target.value)}>
                <option value="WARNING">Warning</option>
                <option value="RESTRICTION">Temporary restriction</option>
              </Select>
            </Field>
            <Field label="Restriction days" htmlFor={`d-${i}`}>
              <Input id={`d-${i}`} {...num(['noShow', 'tiers', i, 'restrictionDays'])} disabled={tier.action === 'WARNING'} />
            </Field>
            <Button variant="ghost" disabled={form.noShow.tiers.length <= 1} onClick={() => setPath(['noShow', 'tiers'], form.noShow.tiers.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </div>
        ))}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const last = form.noShow.tiers[form.noShow.tiers.length - 1];
            setPath(['noShow', 'tiers'], [...form.noShow.tiers, { threshold: Number(last?.threshold || 0) + 1, action: 'RESTRICTION', restrictionDays: 30 }]);
          }}
        >
          Add tier
        </Button>
        <p className="text-xs text-slate-500">Beyond the last tier, the last tier’s penalty applies again. Restrictions are always temporary.</p>
      </Card>

      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <h2 className="font-semibold text-slate-900 sm:col-span-2">Waitlist</h2>
        <Field label="Offer acceptance window (minutes)" htmlFor="wo">
          <Input id="wo" {...num(['waitlist', 'offerMinutes'])} min={1} />
        </Field>
        <Field label="Max live waitlist entries per user" htmlFor="wm">
          <Input id="wm" {...num(['waitlist', 'maxEntriesPerUser'])} min={1} />
        </Field>
      </Card>

      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <h2 className="font-semibold text-slate-900 sm:col-span-2">Reminders</h2>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={form.reminders.enabled} onChange={(e) => setPath(['reminders', 'enabled'], e.target.checked)} /> Send booking reminders
        </label>
        <Field label="Booking reminder (minutes before)" htmlFor="rl">
          <Input id="rl" {...num(['reminders', 'leadMinutes'])} min={15} />
        </Field>
        <Field label="Check-in reminder (minutes before)" htmlFor="rc">
          <Input id="rc" {...num(['reminders', 'checkInLeadMinutes'])} min={5} />
        </Field>
      </Card>

      {save.isError && <Alert>{save.error.message}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending} loadingText="Saving…">
          Save policy
        </Button>
      </div>
    </form>
  );
}
