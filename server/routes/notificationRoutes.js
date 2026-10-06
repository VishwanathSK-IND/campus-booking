import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/auth.js';
import { validate, validateObjectId } from '../middlewares/validate.js';
import { Notification } from '../models/Notification.js';
import { notFound } from '../utils/AppError.js';
import { clock } from '../utils/clock.js';
import { ok, paginationMeta } from '../utils/respond.js';
import { booleanQuery, pagination } from '../validators/common.js';

const router = Router();
router.use(requireAuth);

const listQuery = z.object({ ...pagination, limit: z.coerce.number().int().min(1).max(50).default(20), unread: booleanQuery });

router.get('/', validate({ query: listQuery }), async (req, res) => {
  const { page, limit, unread } = req.valid.query;
  const filter = { user: req.user._id };
  if (unread) filter.isRead = false;
  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter)
      .select('-dedupeKey')
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: req.user._id, isRead: false }),
  ]);
  ok(res, items, 'Notifications loaded', 200, { ...paginationMeta(page, limit, total), unreadCount });
});

router.get('/unread-count', async (req, res) => {
  ok(res, { count: await Notification.countDocuments({ user: req.user._id, isRead: false }) });
});

router.patch('/:notificationId/read', validateObjectId('notificationId'), async (req, res) => {
  // Scoped to the current user: other users' notifications are indistinguishable from missing ones.
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.notificationId, user: req.user._id },
    { isRead: true, readAt: clock.now() },
    { new: true },
  );
  if (!notification) throw notFound('Notification');
  ok(res, notification, 'Marked as read');
});

router.post('/read-all', async (req, res) => {
  const result = await Notification.updateMany({ user: req.user._id, isRead: false }, { isRead: true, readAt: clock.now() });
  ok(res, { updated: result.modifiedCount }, 'All notifications marked as read');
});

export default router;
