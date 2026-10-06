import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { publicUser, User } from '../models/User.js';
import { getStanding } from '../services/userService.js';
import { ok } from '../utils/respond.js';

const router = Router();
router.use(requireAuth);

const profileSchema = z
  .object({ name: z.string().trim().min(2).max(100), department: z.string().trim().max(100) })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'Provide at least one field to update');

router.get('/me/standing', async (req, res) => {
  ok(res, await getStanding(req.user));
});

// Users may edit only their own name/department; role and status are admin-managed.
router.patch('/me', validate({ body: profileSchema }), async (req, res) => {
  const user = await User.findByIdAndUpdate(req.user._id, req.valid.body, { new: true, runValidators: true });
  ok(res, publicUser(user), 'Profile updated');
});

// Approver picker for the admin resource form.
router.get('/approvers', requireRole('ADMIN'), async (_req, res) => {
  const approvers = await User.find({ role: { $in: ['FACULTY', 'ADMIN'] }, isActive: true }).select('name email role').sort({ name: 1 });
  ok(res, approvers);
});

export default router;
