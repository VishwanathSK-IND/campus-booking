import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router';
import { bookingApi } from '../api/endpoints.js';
import { CancelBookingButton, CheckInButton, ReviewButtons } from '../components/BookingActions.jsx';
import { Alert, Card, DescriptionList, ErrorState, Loading, PageHeader, StatusBadge } from '../components/ui.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { duration, formatDate, formatDateTime, formatTime, timeRange } from '../utils/format.js';
import { BOOKING_STATUS } from '../utils/status.js';

export default function BookingDetail() {
  const { bookingId } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const { data: booking, isPending, isError, error, refetch } = useQuery({
    queryKey: ['booking', bookingId],
    queryFn: () => bookingApi.get(bookingId),
  });

  if (isPending) return <Loading label="Loading booking…" />;
  if (isError) return <ErrorState error={error} onRetry={refetch} />;

  const isOwner = String(booking.user) === String(user._id);
  const justCreated = params.get('created') === '1';
  const now = Date.now();
  const checkInUpcoming = isOwner && booking.status === 'CONFIRMED' && now < new Date(booking.checkInOpensAt).getTime();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        back={isOwner ? { to: '/my-bookings', label: 'My bookings' } : { to: user.role === 'ADMIN' ? '/admin/bookings' : '/approvals', label: 'Back' }}
        title={justCreated ? (booking.status === 'PENDING_APPROVAL' ? 'Booking request submitted' : 'Booking confirmed') : 'Booking details'}
        actions={
          <>
            {booking.actions.checkIn && <CheckInButton booking={booking} />}
            {booking.actions.review && <ReviewButtons booking={booking} />}
            {booking.actions.cancel && <CancelBookingButton booking={booking} requireReason={!isOwner} />}
          </>
        }
      />

      {justCreated && booking.status === 'CONFIRMED' && (
        <Alert tone="success" className="mb-6">
          Booking confirmed successfully. Remember to check in at the venue between {formatTime(booking.checkInOpensAt)} and {formatTime(booking.checkInClosesAt)}.
        </Alert>
      )}
      {justCreated && booking.status === 'PENDING_APPROVAL' && (
        <Alert tone="info" className="mb-6">
          Booking request submitted for approval. The slot is held for you and you’ll be notified when it is reviewed.
        </Alert>
      )}
      {booking.status === 'NO_SHOW' && isOwner && (
        <Alert tone="warning" className="mb-6" title="Recorded as a no-show">
          You didn’t check in before {formatTime(booking.checkInClosesAt)}. Repeated no-shows lead to temporary booking restrictions.{' '}
          <Link to="/profile" className="underline">
            See your standing
          </Link>
        </Alert>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div>
            <p className="text-xs tracking-wide text-slate-500 uppercase">Booking ID</p>
            <p className="font-mono text-lg font-semibold text-slate-900">{booking.code}</p>
          </div>
          <StatusBadge map={BOOKING_STATUS} status={booking.status} />
        </div>
        <div className="px-5 py-2">
          <DescriptionList
            items={[
              [
                'Resource',
                <Link key="r" to={`/resources/${booking.resource?._id}`} className="text-brand-700 hover:underline">
                  {booking.resourceSnapshot.name}
                </Link>,
              ],
              ['Location', booking.resourceSnapshot.location],
              ['Date', formatDate(booking.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })],
              ['Time', `${timeRange(booking)} (${duration(booking.durationMinutes)})`],
              ['Purpose', booking.purpose],
              !isOwner && ['Booked by', `${booking.userSnapshot.name} (${booking.userSnapshot.email}, ${booking.userSnapshot.role.toLowerCase()})`],
              ['Approval', { NOT_REQUIRED: 'Not required', PENDING: 'Awaiting review', APPROVED: `Approved${booking.approvedBy ? ` by ${booking.approvedBy.name}` : ''}`, REJECTED: 'Rejected' }[booking.approvalStatus]],
              booking.reviewNote && ['Reviewer note', booking.reviewNote],
              booking.rejectionReason && ['Rejection reason', booking.rejectionReason],
              ['Check-in', booking.checkedInAt ? `Checked in at ${formatTime(booking.checkedInAt)}` : `Window ${formatTime(booking.checkInOpensAt)} – ${formatTime(booking.checkInClosesAt)}`],
              booking.status === 'CONFIRMED' && ['Cancel until', formatDateTime(booking.cancellationDeadlineAt)],
              booking.cancelledAt && ['Cancelled', `${formatDateTime(booking.cancelledAt)}${booking.cancelledBy ? ` by ${booking.cancelledBy.name}` : ''}${booking.cancellationReason ? ` — ${booking.cancellationReason}` : ''}`],
              booking.source === 'WAITLIST' && ['Source', 'Accepted from the waitlist'],
              ['Requested', formatDateTime(booking.createdAt)],
            ]}
          />
        </div>
      </Card>

      {checkInUpcoming && (
        <p className="mt-4 text-sm text-slate-500">The Check in button appears when the check-in window opens at {formatTime(booking.checkInOpensAt)}.</p>
      )}

      <Card className="mt-6 p-5">
        <h2 className="mb-3 font-semibold text-slate-900">History</h2>
        <ol className="relative space-y-4 border-l border-slate-200 pl-5">
          {booking.statusHistory.map((entry, i) => (
            <li key={i} className="text-sm">
              <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-brand-500 ring-4 ring-white" aria-hidden="true" />
              <p className="font-medium text-slate-800">
                {entry.from ? `${BOOKING_STATUS[entry.from]?.label} → ` : ''}
                {BOOKING_STATUS[entry.to]?.label}
              </p>
              <p className="text-slate-500">
                {formatDateTime(entry.at)}
                {entry.note ? ` · ${entry.note}` : ''}
              </p>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
