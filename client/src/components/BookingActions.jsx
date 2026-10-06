import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { bookingApi } from '../api/endpoints.js';
import { useToast } from '../hooks/useToast.jsx';
import QrScanner from './QrScanner.jsx';
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

export function CheckInButton({ booking, size = 'md' }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const invalidate = useInvalidate();
  const mutation = useMutation({
    mutationFn: (token) => bookingApi.checkIn(booking._id, token),
    onSuccess: (res) => {
      invalidate(booking);
      toast.success(res.message);
      setOpen(false);
    },
  });
  return (
    <>
      <Button size={size} onClick={() => (mutation.reset(), setOpen(true))}>
        Check in
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Check in · ${booking.resourceSnapshot?.name}`}>
        {mutation.isError && (
          <Alert className="mb-4" title="Check-in rejected">
            {mutation.error.message}
          </Alert>
        )}
        {open && <QrScanner busy={mutation.isPending} onCode={({ token }) => !mutation.isPending && mutation.mutate(token)} />}
      </Modal>
    </>
  );
}
