import { Router } from 'express';
import * as bookings from '../controllers/bookingController.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate, validateObjectId } from '../middlewares/validate.js';
import {
  approveSchema,
  cancelSchema,
  checkInCandidatesQuery,
  checkInSchema,
  createBookingSchema,
  myBookingsQuery,
  pendingApprovalsQuery,
  rejectSchema,
} from '../validators/bookingValidators.js';

const router = Router();
const id = validateObjectId('bookingId');
const reviewers = requireRole('FACULTY', 'ADMIN');

router.use(requireAuth);

router.post('/', validate({ body: createBookingSchema }), bookings.create);
router.get('/', validate({ query: myBookingsQuery }), bookings.listMine);
router.get('/pending-approvals', reviewers, validate({ query: pendingApprovalsQuery }), bookings.pendingApprovals);
router.get('/check-in-candidates', validate({ query: checkInCandidatesQuery }), bookings.checkInCandidates);

// Ownership / reviewer assignment is enforced per booking in the service layer.
router.get('/:bookingId', id, bookings.detail);
router.post('/:bookingId/approve', id, reviewers, validate({ body: approveSchema }), bookings.approve);
router.post('/:bookingId/reject', id, reviewers, validate({ body: rejectSchema }), bookings.reject);
router.post('/:bookingId/cancel', id, validate({ body: cancelSchema }), bookings.cancel);
router.post('/:bookingId/check-in', id, validate({ body: checkInSchema }), bookings.checkIn);

export default router;
