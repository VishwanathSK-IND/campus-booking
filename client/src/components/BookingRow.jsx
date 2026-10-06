import { Link } from 'react-router';
import { formatDate, timeRange } from '../utils/format.js';
import { BOOKING_STATUS } from '../utils/status.js';
import { CancelBookingButton, CheckInButton } from './BookingActions.jsx';
import { Badge, ButtonLink, StatusBadge } from './ui.jsx';

const APPROVAL = { PENDING: ['Awaiting approval', 'amber'], APPROVED: ['Approved', 'green'], REJECTED: ['Rejected', 'red'] };

/** One booking with only the actions valid for its current state (as computed by the server). */
export default function BookingRow({ booking, showUser = false }) {
  const approval = APPROVAL[booking.approvalStatus];
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/bookings/${booking._id}`} className="font-medium text-slate-900 hover:text-brand-700">
            {booking.resourceSnapshot.name}
          </Link>
          <StatusBadge map={BOOKING_STATUS} status={booking.status} />
          {approval && booking.status !== 'PENDING_APPROVAL' && <Badge tone={approval[1]}>{approval[0]}</Badge>}
          {booking.status === 'CHECKED_IN' && <Badge tone="blue">Checked in</Badge>}
          {booking.source === 'WAITLIST' && <Badge tone="violet">From waitlist</Badge>}
        </div>
        <p className="mt-0.5 text-sm text-slate-500">
          {formatDate(booking.date)} · {timeRange(booking)} · {booking.resourceSnapshot.location}
        </p>
        {showUser && (
          <p className="text-sm text-slate-500">
            {booking.userSnapshot.name} · {booking.userSnapshot.email}
          </p>
        )}
        <p className="font-mono text-xs text-slate-400">{booking.code}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {booking.actions?.checkIn && <CheckInButton booking={booking} size="sm" />}
        {booking.actions?.cancel && <CancelBookingButton booking={booking} size="sm" />}
        <ButtonLink to={`/bookings/${booking._id}`} variant="secondary" size="sm">
          View details
        </ButtonLink>
      </div>
    </li>
  );
}
