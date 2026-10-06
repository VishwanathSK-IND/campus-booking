import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate, validateObjectId } from '../middlewares/validate.js';
import * as waitlist from '../services/waitlistService.js';
import { created, ok, paginationMeta } from '../utils/respond.js';
import { joinWaitlistSchema, myWaitlistQuery } from '../validators/bookingValidators.js';

const router = Router();
const id = validateObjectId('entryId');

router.use(requireAuth);

router.post('/', validate({ body: joinWaitlistSchema }), async (req, res) => {
  const { entry, position } = await waitlist.joinWaitlist(req.user, req.valid.body);
  created(res, { ...entry.toObject(), position }, 'You have been added to the waitlist');
});

router.get('/', validate({ query: myWaitlistQuery }), async (req, res) => {
  const query = req.valid.query;
  const { items, total } = await waitlist.listMyWaitlist(req.user, query);
  ok(res, items, 'Waitlist loaded', 200, paginationMeta(query.page, query.limit, total));
});

router.post('/:entryId/accept', id, async (req, res) => {
  const { booking } = await waitlist.acceptOffer(req.params.entryId, req.user);
  const message = booking.status === 'PENDING_APPROVAL' ? 'Offer accepted — booking submitted for approval' : 'Offer accepted — booking confirmed';
  ok(res, booking, message);
});

router.post('/:entryId/decline', id, async (req, res) => {
  ok(res, await waitlist.declineOffer(req.params.entryId, req.user), 'Offer declined');
});

router.delete('/:entryId', id, async (req, res) => {
  ok(res, await waitlist.leaveWaitlist(req.params.entryId, req.user), 'You have left the waitlist');
});

export default router;
