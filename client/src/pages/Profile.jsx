import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { userApi } from '../api/endpoints.js';
import { Alert, Button, Card, DescriptionList, Field, Input, Loading, PageHeader } from '../components/ui.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { useToast } from '../hooks/useToast.jsx';
import { formatDate, formatDateTime, timeRange } from '../utils/format.js';

export default function Profile() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: user.name, department: user.department || '' });
  const standing = useQuery({ queryKey: ['standing'], queryFn: userApi.standing });
  const save = useMutation({
    mutationFn: () => userApi.updateProfile(form),
    onSuccess: (res) => {
      queryClient.setQueryData(['auth', 'me'], res.data);
      toast.success(res.message);
    },
  });
  const s = standing.data;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Profile" />
      <Card className="p-5">
        <h2 className="mb-3 font-semibold text-slate-900">Account</h2>
        <DescriptionList
          items={[
            ['Email', user.email],
            ['Role', <span key="r" className="capitalize">{user.role.toLowerCase()}</span>],
            ['Member since', formatDate(user.createdAt)],
          ]}
        />
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Name" htmlFor="p-name">
            <Input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Department" htmlFor="p-dept">
            <Input id="p-dept" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
          </Field>
          {save.isError && <Alert className="sm:col-span-2">{save.error.message}</Alert>}
          <div className="sm:col-span-2">
            <Button type="submit" loading={save.isPending} loadingText="Saving…">
              Save changes
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 font-semibold text-slate-900">Booking standing</h2>
        {standing.isPending ? (
          <Loading />
        ) : (
          <>
            {s.activeRestriction ? (
              <Alert tone="error" title="Restricted">
                New bookings are blocked until {formatDateTime(s.activeRestriction.endsAt)}. Reason: {s.activeRestriction.reason}
              </Alert>
            ) : (
              <Alert tone="success">You are in good standing and can make bookings.</Alert>
            )}
            <p className="mt-4 text-sm text-slate-600">
              Active bookings: <strong>{s.activeBookings}</strong> of {s.maxActiveBookings} allowed.
            </p>
            <h3 className="mt-5 text-sm font-medium text-slate-700">No-show policy (last {s.noShowLookbackDays} days)</h3>
            <ul className="mt-1 list-inside list-disc text-sm text-slate-600">
              {s.noShowTiers.map((t) => (
                <li key={t.threshold}>
                  {t.threshold}
                  {t.threshold === s.noShowTiers[s.noShowTiers.length - 1].threshold ? '+' : ''} no-show(s):{' '}
                  {t.action === 'WARNING' ? 'warning' : `bookings restricted for ${t.restrictionDays} day(s)`}
                </li>
              ))}
            </ul>
            <h3 className="mt-5 text-sm font-medium text-slate-700">Your recent no-shows ({s.recentNoShows.length})</h3>
            {s.recentNoShows.length === 0 ? (
              <p className="text-sm text-slate-500">None — thank you for checking in!</p>
            ) : (
              <ul className="mt-1 divide-y divide-slate-100 text-sm">
                {s.recentNoShows.map((r) => (
                  <li key={r._id} className="flex justify-between py-2">
                    <Link to={`/bookings/${r.booking?._id}`} className="text-brand-700 hover:underline">
                      {r.booking?.resourceSnapshot?.name} · {formatDate(r.booking?.date)} {r.booking && timeRange(r.booking)}
                    </Link>
                    <span className="text-slate-500">{r.penaltyApplied === 'WARNING' ? 'Warning' : 'Restriction'}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
