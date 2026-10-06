import { Router } from 'express';
import * as resources from '../controllers/resourceController.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate, validateObjectId } from '../middlewares/validate.js';
import {
  availabilityQuery,
  blockSchema,
  createResourceSchema,
  listResourcesQuery,
  resourceStatusSchema,
  updateResourceSchema,
} from '../validators/resourceValidators.js';

const router = Router();
const admin = requireRole('ADMIN');
const id = validateObjectId('resourceId');

router.use(requireAuth);

router.get('/', validate({ query: listResourcesQuery }), resources.list);
router.get('/locations', resources.locations);
router.post('/', admin, validate({ body: createResourceSchema }), resources.create);

router.get('/:resourceId', id, resources.detail);
router.get('/:resourceId/availability', id, validate({ query: availabilityQuery }), resources.availability);
// Authorisation (admin or assigned faculty) is checked in the service.
router.get('/:resourceId/check-in-token', id, resources.checkInToken);

router.patch('/:resourceId', id, admin, validate({ body: updateResourceSchema }), resources.update);
router.patch('/:resourceId/status', id, admin, validate({ body: resourceStatusSchema }), resources.changeStatus);
router.post('/:resourceId/blocks', id, admin, validate({ body: blockSchema }), resources.addBlock);
router.delete('/:resourceId/blocks/:blockId', validateObjectId('resourceId', 'blockId'), admin, resources.removeBlock);

export default router;
