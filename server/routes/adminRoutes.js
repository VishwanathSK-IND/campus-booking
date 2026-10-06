import { Router } from 'express';
import * as admin from '../controllers/adminController.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate, validateObjectId } from '../middlewares/validate.js';
import {
  analyticsQuery,
  auditQuery,
  createUserSchema,
  liftRestrictionSchema,
  listUsersQuery,
  policySchema,
  restrictionSchema,
  updateUserSchema,
} from '../validators/adminValidators.js';
import { adminBookingsQuery } from '../validators/bookingValidators.js';

const router = Router();
const adminOnly = requireRole('ADMIN');

router.use(requireAuth);

// Faculty get a limited (assigned-resources) view; scope is enforced in the controller.
router.get('/analytics', requireRole('ADMIN', 'FACULTY'), validate({ query: analyticsQuery }), admin.analytics);

router.use(adminOnly);

router.get('/dashboard', admin.dashboard);

router.get('/users', validate({ query: listUsersQuery }), admin.listUsers);
router.post('/users', validate({ body: createUserSchema }), admin.createUser);
router.get('/users/:userId', validateObjectId('userId'), admin.userDetail);
router.patch('/users/:userId', validateObjectId('userId'), validate({ body: updateUserSchema }), admin.updateUser);
router.post('/users/:userId/restrictions', validateObjectId('userId'), validate({ body: restrictionSchema }), admin.restrictUser);
router.post(
  '/restrictions/:restrictionId/lift',
  validateObjectId('restrictionId'),
  validate({ body: liftRestrictionSchema }),
  admin.liftUserRestriction,
);

router.get('/bookings', validate({ query: adminBookingsQuery }), admin.listBookings);

router.get('/policy', admin.policy);
router.put('/policy', validate({ body: policySchema }), admin.savePolicy);

router.get('/audit-logs', validate({ query: auditQuery }), admin.auditLogs);
router.post('/jobs/run', admin.runJobs);

export default router;
