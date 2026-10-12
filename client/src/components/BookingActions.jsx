import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { bookingApi } from '../api/endpoints.js';
import { useToast } from '../hooks/useToast.jsx';
import { formatTime } from '../utils/format.js';
import { Alert, Button, Field, Modal, Textarea } from './ui.jsx';

function useInvalidate() {
  const queryClient = useQueryClient();
  return (booking) => {
    queryClient.invalidateQueries({ queryKey: ['bookings'] });
    queryClient.invalidateQueries({ queryKey: ['booking', booking._id] });
    queryClient.invalidateQueries({ queryKey: ['approvals'] });
    queryClient.invalidateQueries({ queryKey: ['availability', String(booking.resource?._id || booking.resource)] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['admin'] });
  };
}

export function CancelBookingButton({ booking, requireReason, size = 'md' }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const toast = useToast();
  const invalidate = useInvalidate();
  const mutation = useMutation({
    mutationFn: () => bookingApi.cancel(booking._id, { reason: reason || undefined }),
    onSuccess: (res) => {
      invalidate(booking);
      toast.success(res.message);
      setOpen(false);
    },
  });
  return (
    <>
      <Button variant="secondary" size={size} onClick={() => (mutation.reset(), setOpen(true))}>
        Cancel
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Cancel booking?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Keep booking
            </Button>
            <Button variant="danger" loading={mutation.isPending} loadingText="Cancelling…" disabled={requireReason && reason.trim().length < 3} onClick={() => mutation.mutate()}>
              Cancel booking
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          {booking.resourceSnapshot?.name} on {booking.date}, {booking.startTime}–{booking.endTime}. The slot will be released and offered to the waitlist.
        </p>
        <Field label={requireReason ? 'Reason (required, shared with the user)' : 'Reason (optional)'} htmlFor="cancel-reason">
          <Textarea id="cancel-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {mutation.isError && <Alert className="mt-3">{mutation.error.message}</Alert>}
      </Modal>
    </>
  );
}

export function ReviewButtons({ booking, size = 'md' }) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const toast = useToast();
  const invalidate = useInvalidate();
  const approve = useMutation({
    mutationFn: () => bookingApi.approve(booking._id, {}),
    onSuccess: (res) => (invalidate(booking), toast.success(res.message)),
    onError: (err) => (invalidate(booking), toast.error(err.message)),
  });
  const reject = useMutation({
    mutationFn: () => bookingApi.reject(booking._id, { reason }),
    onSuccess: (res) => {
      invalidate(booking);
      toast.success(res.message);
      setRejectOpen(false);
    },
  });
  return (
    <>
      <Button variant="success" size={size} loading={approve.isPending} loadingText="Approving…" onClick={() => approve.mutate()}>
        Approve
      </Button>
      <Button variant="secondary" size={size} onClick={() => (reject.reset(), setRejectOpen(true))}>
        Reject
      </Button>
      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Reject booking request"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>
              Back
            </Button>
            <Button variant="danger" loading={reject.isPending} loadingText="Rejecting…" disabled={reason.trim().length < 3} onClick={() => reject.mutate()}>
              Reject request
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          {booking.userSnapshot?.name} · {booking.resourceSnapshot?.name} · {booking.date} {booking.startTime}–{booking.endTime}
        </p>
        <Field label="Reason (shared with the requester)" htmlFor="reject-reason">
          <Textarea id="reject-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {reject.isError && <Alert className="mt-3">{reject.error.message}</Alert>}
      </Modal>
    </>
  );
}

/** Re-renders when the clock crosses the booking's start time and again when the check-in window closes. */
function useCheckInClock(startAt, closesAt) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const next = [startAt, closesAt].map((t) => new Date(t).getTime()).find((t) => t >= now);
    if (next === undefined) return undefined;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(next - now + 250, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [now, startAt, closesAt]);
  return now;
}

/** One-click check-in: shown disabled until the booked start time, then enabled until the grace period ends. */
export function CheckInButton({ booking, size = 'md' }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const now = useCheckInClock(booking.startAt, booking.checkInClosesAt);
  const mutation = useMutation({
    mutationFn: () => bookingApi.checkIn(booking._id),
    onSuccess: (res) => (invalidate(booking), toast.success(res.message)),
    onError: (err) => (invalidate(booking), toast.error(err.message)),
  });
  if (now > new Date(booking.checkInClosesAt).getTime()) return null;
  const early = now < new Date(booking.startAt).getTime();
  return (
    <Button size={size} disabled={early} loading={mutation.isPending} loadingText="Checking in…" onClick={() => mutation.mutate()}>
      {early ? `Check in at ${formatTime(booking.startAt)}` : 'Check in'}
    </Button>
  );
}
