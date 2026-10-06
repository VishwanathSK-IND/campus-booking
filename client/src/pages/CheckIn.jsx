import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { bookingApi } from '../api/endpoints.js';
import QrScanner from '../components/QrScanner.jsx';
import { Alert, Button, ButtonLink, Card, EmptyState, ErrorState, Loading, PageHeader, StatusBadge } from '../components/ui.jsx';
import { useToast } from '../hooks/useToast.jsx';
import { formatDate, formatTime, timeRange } from '../utils/format.js';
import { BOOKING_STATUS } from '../utils/status.js';

/**
 * Landing page for the venue QR code (…/check-in?resource=…&token=…). Lists the
 * user's bookings at that resource and submits the scanned token; the server
 * decides whether the check-in is valid.
 */
export default function CheckIn() {
  const [params, setParams] = useSearchParams();
  const resource = params.get('resource');
  const token = params.get('token');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [done, setDone] = useState(null);

  const candidates = useQuery({
    queryKey: ['bookings', 'check-in-candidates', resource],
    queryFn: () => bookingApi.checkInCandidates(resource),
    enabled: Boolean(resource && token),
  });
  const checkIn = useMutation({
    mutationFn: (bookingId) => bookingApi.checkIn(bookingId, token),
    onSuccess: (res) => {
      setDone(res.data);
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
  });

  if (!resource || !token) {
    return (
      <div className="mx-auto max-w-md">
        <PageHeader title="Check in" description="Scan the QR code displayed at the venue." />
        <Card className="p-5">
          <QrScanner onCode={(code) => code.resource && setParams({ resource: code.resource, token: code.token })} />
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md">
        <Alert tone="success" title="Successfully checked in">
          {done.resourceSnapshot.name}, {timeRange(done)}. Enjoy your session!
        </Alert>
        <ButtonLink to={`/bookings/${done._id}`} variant="secondary" className="mt-4">
          View booking
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="Check in" description="Select the booking you are checking in to." />
      {checkIn.isError && (
        <Alert className="mb-4" title="Check-in rejected">
          {checkIn.error.message}
        </Alert>
      )}
      {candidates.isPending ? (
        <Loading label="Finding your bookings…" />
      ) : candidates.isError ? (
        <ErrorState error={candidates.error} onRetry={candidates.refetch} />
      ) : candidates.data.length === 0 ? (
        <EmptyState title="No booking to check in to" description="You don’t have a confirmed booking at this venue today." action={<ButtonLink to="/my-bookings">My bookings</ButtonLink>} />
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {candidates.data.map((b) => (
              <li key={b._id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium text-slate-900">{b.resourceSnapshot.name}</p>
                  <p className="text-sm text-slate-500">
                    {formatDate(b.date)} · {timeRange(b)}
                  </p>
                  <p className="text-xs text-slate-500">
                    Check-in {formatTime(b.checkInOpensAt)} – {formatTime(b.checkInClosesAt)}
                  </p>
                </div>
                {b.status === 'CHECKED_IN' ? (
                  <StatusBadge map={BOOKING_STATUS} status="CHECKED_IN" />
                ) : (
                  <Button loading={checkIn.isPending && checkIn.variables === b._id} loadingText="Checking in…" onClick={() => checkIn.mutate(b._id)}>
                    Check in
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="mt-4 text-center text-sm text-slate-500">
        Wrong venue? <Link to="/check-in" className="text-brand-700 hover:underline">Scan again</Link>
      </p>
    </div>
  );
}
