import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router';
import { resourceApi } from '../api/endpoints.js';
import AvailabilityGrid from '../components/AvailabilityGrid.jsx';
import { Alert, Badge, ButtonLink, Card, DescriptionList, ErrorState, Field, Input, Loading, PageHeader, StatusBadge } from '../components/ui.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { useWatchResource } from '../hooks/useSocket.jsx';
import { campusDate, CATEGORY_LABELS, DAY_NAMES, duration, formatClock } from '../utils/format.js';
import { RESOURCE_STATUS } from '../utils/status.js';

export function RulesList({ rules }) {
  return (
    <DescriptionList
      items={[
        ['Slot length', `${rules.slotMinutes} minutes`],
        ['Duration', `${duration(rules.minDurationMinutes)} – ${duration(rules.maxDurationMinutes)}`],
        ['Book ahead', `Up to ${rules.maxAdvanceDays} days in advance`],
        ['Per-user limit', `${rules.maxActiveBookingsPerUser} active booking(s)`],
        ['Who can book', rules.allowedRoles.map((r) => r.toLowerCase()).join(', ')],
        ['Approval', rules.approvalRequired ? `Required (exempt: ${rules.approvalExemptRoles.map((r) => r.toLowerCase()).join(', ') || 'none'})` : 'Not required'],
        ['Priority', rules.facultyPriority ? 'Faculty requests are prioritised in approval and waitlist queues' : 'First come, first served'],
        ['Cancellation', `Until ${duration(rules.cancellationDeadlineMinutes) || '0 min'} before start`],
        ['Check-in', `From ${rules.checkInOpensBeforeMinutes} min before to ${rules.checkInGraceMinutes} min after start, or it becomes a no-show`],
      ]}
    />
  );
}

export default function ResourceDetail() {
  const { resourceId } = useParams();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') || campusDate();
  useWatchResource(resourceId);

  const resourceQuery = useQuery({ queryKey: ['resource', resourceId], queryFn: () => resourceApi.get(resourceId) });
  const availabilityQuery = useQuery({
    queryKey: ['availability', resourceId, date],
    queryFn: () => resourceApi.availability(resourceId, date),
    enabled: resourceQuery.isSuccess,
  });

  if (resourceQuery.isPending) return <Loading label="Loading resource…" />;
  if (resourceQuery.isError) return <ErrorState error={resourceQuery.error} onRetry={resourceQuery.refetch} />;
  const resource = resourceQuery.data;
  const bookable = resource.status === 'ACTIVE' && resource.bookingRules.allowedRoles.includes(user.role);

  return (
    <div>
      <PageHeader
        back={{ to: '/resources', label: 'All resources' }}
        title={resource.name}
        description={`${CATEGORY_LABELS[resource.category]} · ${resource.location}${resource.capacity ? ` · ${resource.capacity} seats` : ''}`}
        actions={
          <>
            {user.role === 'ADMIN' && (
              <ButtonLink to={`/admin/resources/${resource._id}/edit`} variant="secondary">
                Edit
              </ButtonLink>
            )}
            {resource.canManageCheckIn && (
              <ButtonLink to={`/kiosk/${resource._id}`} variant="secondary">
                Check-in kiosk
              </ButtonLink>
            )}
            {bookable && <ButtonLink to={`/resources/${resource._id}/book?date=${date}`}>Book this resource</ButtonLink>}
          </>
        }
      />

      {resource.status !== 'ACTIVE' && (
        <Alert tone="warning" className="mb-6" title={resource.status === 'MAINTENANCE' ? 'Under maintenance' : 'Not available'}>
          New bookings are disabled{resource.statusReason ? `: ${resource.statusReason}` : '.'}
        </Alert>
      )}
      {resource.status === 'ACTIVE' && !resource.bookingRules.allowedRoles.includes(user.role) && (
        <Alert tone="info" className="mb-6">
          This resource can only be booked by {resource.bookingRules.allowedRoles.map((r) => r.toLowerCase()).join(', ')} accounts.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-900">Availability</h2>
                <p className="text-sm text-slate-500">Live — updates automatically when others book or cancel.</p>
              </div>
              <Field label="Date" htmlFor="date">
                <Input id="date" type="date" min={campusDate()} value={date} onChange={(e) => e.target.value && setParams({ date: e.target.value }, { replace: true })} />
              </Field>
            </div>
            {availabilityQuery.isPending ? (
              <Loading label="Checking availability…" />
            ) : availabilityQuery.isError ? (
              <ErrorState error={availabilityQuery.error} onRetry={availabilityQuery.refetch} />
            ) : (
              <AvailabilityGrid availability={availabilityQuery.data} />
            )}
            {bookable && availabilityQuery.data?.open && (
              <p className="mt-4 text-sm text-slate-600">
                Found a free slot?{' '}
                <Link to={`/resources/${resource._id}/book?date=${date}`} className="font-medium text-brand-700 hover:underline">
                  Book it
                </Link>
                . Slot taken? You can join its waitlist from the booking page.
              </p>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-2 font-semibold text-slate-900">About</h2>
            <p className="text-sm whitespace-pre-line text-slate-600">{resource.description || 'No description.'}</p>
            {resource.facilities.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {resource.facilities.map((f) => (
                  <Badge key={f}>{f}</Badge>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Status</h2>
              <StatusBadge map={RESOURCE_STATUS} status={resource.status} />
            </div>
            <h3 className="mt-4 mb-1 text-sm font-medium text-slate-700">Operating hours</h3>
            <ul className="text-sm text-slate-600">
              {DAY_NAMES.map((name, day) => {
                const h = resource.operatingHours.find((x) => x.day === day);
                return (
                  <li key={name} className="flex justify-between py-0.5">
                    <span>{name}</span>
                    <span>{h ? `${formatClock(h.open)} – ${formatClock(h.close)}` : 'Closed'}</span>
                  </li>
                );
              })}
            </ul>
            {resource.approvers?.length > 0 && (
              <p className="mt-4 text-sm text-slate-600">
                Approvers: {resource.approvers.map((a) => a.name).join(', ')}
              </p>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="mb-1 font-semibold text-slate-900">Booking rules</h2>
            <RulesList rules={resource.bookingRules} />
          </Card>
        </div>
      </div>
    </div>
  );
}
