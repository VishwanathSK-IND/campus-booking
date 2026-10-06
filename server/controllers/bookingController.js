import * as bookings from '../services/bookingService.js';
import { badRequest } from '../utils/AppError.js';
import { created, ok, paginationMeta } from '../utils/respond.js';
import { idempotencyKeyHeader } from '../validators/bookingValidators.js';

export async function create(req, res) {
  const header = idempotencyKeyHeader.safeParse(req.get('Idempotency-Key') || undefined);
  if (!header.success) throw badRequest('INVALID_IDEMPOTENCY_KEY', header.error.issues[0].message);

  const { result, replayed } = await bookings.createBooking(req.user, req.valid.body, header.data);
  const message =
    result.status === 'PENDING_APPROVAL' ? 'Booking request submitted for approval' : 'Booking confirmed successfully';
  if (replayed) return ok(res, result, `${message} (duplicate request — original booking returned)`);
  created(res, result, message);
}

export async function listMine(req, res) {
  const query = req.valid.query;
  const { items, total } = await bookings.listMyBookings(req.user, query);
  ok(res, items, 'Bookings loaded', 200, paginationMeta(query.page, query.limit, total));
}

export async function pendingApprovals(req, res) {
  const query = req.valid.query;
  const { items, total } = await bookings.listPendingApprovals(req.user, query);
  ok(res, items, 'Pending approvals loaded', 200, paginationMeta(query.page, query.limit, total));
}

export async function checkInCandidates(req, res) {
  ok(res, await bookings.checkInCandidates(req.user, req.valid.query.resource));
}

export async function detail(req, res) {
  ok(res, await bookings.getBookingForViewer(req.params.bookingId, req.user));
}

export async function approve(req, res) {
  ok(res, await bookings.approveBooking(req.params.bookingId, req.user, req.valid.body), 'Booking approved');
}

export async function reject(req, res) {
  ok(res, await bookings.rejectBooking(req.params.bookingId, req.user, req.valid.body), 'Booking rejected');
}

export async function cancel(req, res) {
  ok(res, await bookings.cancelBooking(req.params.bookingId, req.user, req.valid.body), 'Booking cancelled');
}

export async function checkIn(req, res) {
  ok(res, await bookings.checkIn(req.params.bookingId, req.user, req.valid.body.token), 'Successfully checked in');
}
