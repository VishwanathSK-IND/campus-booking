import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { bookingApi, resourceApi, waitlistApi } from '../api/endpoints.js';
import AvailabilityGrid from '../components/AvailabilityGrid.jsx';
import { Alert, Button, Card, DescriptionList, ErrorState, Field, Input, Loading, PageHeader, Select, Textarea } from '../components/ui.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { useWatchResource } from '../hooks/useSocket.jsx';
import { useToast } from '../hooks/useToast.jsx';
import { campusDate, duration, formatClock, formatDate, fromMinutes, newIdempotencyKey, toMinutes } from '../utils/format.js';

export default function BookResource() {
  const { resourceId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  useWatchResource(resourceId);

  const [date, setDate] = useState(params.get('date') || campusDate());
  const [selection, setSelection] = useState(null);
  const [purpose, setPurpose] = useState('');
  const [error, setError] = useState(null);
  // One idempotency key per intended booking: double clicks and retries reuse it.
  const idempotencyKey = useRef(newIdempotencyKey());
  useEffect(() => {
    idempotencyKey.current = newIdempotencyKey();
  }, [date, selection?.start, selection?.end, purpose]);

  const resourceQuery = useQuery({ queryKey: ['resource', resourceId], queryFn: () => resourceApi.get(resourceId) });
  const availabilityQuery = useQuery({
    queryKey: ['availability', resourceId, date],
    queryFn: () => resourceApi.availability(resourceId, date),
    enabled: resourceQuery.isSuccess,
  });
  const availability = availabilityQuery.data;
  const rules = resourceQuery.data?.bookingRules;

  // Reset the selection when the date changes.
  useEffect(() => setSelection(null), [date]);

  const selectedSlots = useMemo(() => {
    if (!selection || !availability?.slots) return [];
    return availability.slots.filter((s) => s.startTime >= selection.start && s.endTime <= selection.end);
  }, [selection, availability]);
  const blocked = selectedSlots.filter((s) => s.status !== 'AVAILABLE');
  const minutes = selection ? toMinutes(selection.end) - toMinutes(selection.start) : 0;

  const clientIssues = [];
  if (selection && rules) {
    if (minutes > rules.maxDurationMinutes) clientIssues.push(`Maximum duration is ${duration(rules.maxDurationMinutes)}.`);
    if (minutes < rules.minDurationMinutes) clientIssues.push(`Minimum duration is ${duration(rules.minDurationMinutes)}.`);
  }
  const canWaitlist = blocked.length > 0 && blocked.every((s) => ['BOOKED', 'PENDING', 'HELD', 'BLOCKED'].includes(s.status)) && clientIssues.length === 0;

  const onSuccessCommon = () => {
    queryClient.invalidateQueries({ queryKey: ['availability', resourceId] });
    queryClient.invalidateQueries({ queryKey: ['bookings'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const book = useMutation({
    mutationFn: () =>
      bookingApi.create({ resourceId, date, startTime: selection.start, endTime: selection.end, purpose }, idempotencyKey.current),
    onSuccess: (res) => {
      onSuccessCommon();
      toast.success(res.message);
      navigate(`/bookings/${res.data._id}?created=1`);
    },
    onError: (err) => {
      setError(err);
      // A rejected request should be retryable as a new attempt.
      if (err.code !== 'REQUEST_IN_PROGRESS') idempotencyKey.current = newIdempotencyKey();
      queryClient.invalidateQueries({ queryKey: ['availability', resourceId, date] });
    },
  });

  const joinWaitlist = useMutation({
    mutationFn: () => waitlistApi.join({ resourceId, date, startTime: selection.start, endTime: selection.end, purpose }),
    onSuccess: (res) => {
      onSuccessCommon();
      queryClient.invalidateQueries({ queryKey: ['waitlist'] });
      toast.success(`${res.message}. You are #${res.data.position} in line.`);
      navigate('/my-bookings?tab=waitlist');
    },
    onError: (err) => setError(err),
  });

  if (resourceQuery.isPending) return <Loading label="Loading resource…" />;
  if (resourceQuery.isError) return <ErrorState error={resourceQuery.error} onRetry={resourceQuery.refetch} />;
  const resource = resourceQuery.data;
  const needsApproval = rules.approvalRequired && !rules.approvalExemptRoles.includes(user.role);

  const startOptions = availability?.open ? availability.slots.map((s) => s.startTime) : [];
  const endOptions = availability?.open && selection ? availability.slots.filter((s) => s.startTime >= selection.start).map((s) => s.endTime) : [];

  const submit = (event) => {
    event.preventDefault();
    setError(null);
    if (canWaitlist) joinWaitlist.mutate();
    else book.mutate();
  };

  return (
    <div>
      <PageHeader back={{ to: `/resources/${resourceId}`, label: resource.name }} title={`Book ${resource.name}`} description={resource.location} />

      {resource.status !== 'ACTIVE' && (
        <Alert tone="warning" className="mb-6">
          {resource.name} is {resource.status === 'MAINTENANCE' ? 'under maintenance' : 'inactive'} and cannot be booked right now.
        </Alert>
      )}

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <Field label="Date" htmlFor="date">
              <Input id="date" type="date" min={campusDate()} max={campusDate(rules.maxAdvanceDays)} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} required />
            </Field>
            <p className="text-sm text-slate-500">Click a start slot, then a later slot to extend the booking.</p>
          </div>
          {availabilityQuery.isPending ? (
            <Loading label="Checking availability…" />
          ) : availabilityQuery.isError ? (
            <ErrorState error={availabilityQuery.error} onRetry={availabilityQuery.refetch} />
          ) : (
            <AvailabilityGrid availability={availability} selection={selection} onSelect={(s) => (setSelection(s), setError(null))} />
          )}
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <h2 className="font-semibold text-slate-900">Booking details</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start time" htmlFor="start">
              <Select id="start" value={selection?.start || ''} onChange={(e) => {
                const start = e.target.value;
                if (!start) return setSelection(null);
                const end = fromMinutes(toMinutes(start) + rules.slotMinutes);
                setSelection({ start, end: selection?.end > start ? selection.end : end, locked: true });
              }}>
                <option value="">Select</option>
                {startOptions.map((t) => (
                  <option key={t} value={t}>
                    {formatClock(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="End time" htmlFor="end">
              <Select id="end" value={selection?.end || ''} disabled={!selection} onChange={(e) => setSelection({ ...selection, end: e.target.value, locked: true })}>
                {endOptions.map((t) => (
                  <option key={t} value={t}>
                    {formatClock(t)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Purpose" htmlFor="purpose" hint="Visible to approvers and administrators.">
            <Textarea id="purpose" rows={3} maxLength={500} required value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. DBMS mini-project with my team" />
          </Field>

          <div className="rounded-lg bg-slate-50 p-3">
            <h3 className="text-sm font-medium text-slate-700">Summary</h3>
            <DescriptionList
              items={[
                ['Resource', resource.name],
                ['Date', formatDate(date)],
                ['Time', selection ? `${formatClock(selection.start)} – ${formatClock(selection.end)}` : '—'],
                ['Duration', selection ? duration(minutes) : '—'],
              ]}
            />
          </div>

          {needsApproval && !canWaitlist && (
            <Alert tone="info">This booking requires faculty/admin approval. The slot is held for you while your request is reviewed.</Alert>
          )}
          {clientIssues.map((issue) => (
            <Alert key={issue} tone="warning">
              {issue}
            </Alert>
          ))}
          {canWaitlist && (
            <Alert tone="warning" title="Part of this time is taken">
              You can join the waitlist. If it frees up, the slot is offered to the next person in line for a limited time.
            </Alert>
          )}
          {blocked.length > 0 && !canWaitlist && clientIssues.length === 0 && (
            <Alert tone="warning">The selected time includes slots that cannot be booked.</Alert>
          )}
          {error && (
            <Alert title={error.code === 'BOOKING_CONFLICT' ? 'That time was just taken' : 'Could not complete your request'}>
              {error.message}
            </Alert>
          )}

          <Button
            type="submit"
            size="lg"
            variant={canWaitlist ? 'secondary' : 'primary'}
            loading={book.isPending || joinWaitlist.isPending}
            loadingText={canWaitlist ? 'Joining waitlist…' : 'Creating booking…'}
            disabled={!selection || purpose.trim().length < 3 || clientIssues.length > 0 || resource.status !== 'ACTIVE' || (blocked.length > 0 && !canWaitlist)}
          >
            {canWaitlist ? 'Join waitlist' : needsApproval ? 'Request booking' : 'Book now'}
          </Button>
          <p className="text-xs text-slate-500">All rules are re-checked by the server when you submit.</p>
        </Card>
      </form>
    </div>
  );
}
