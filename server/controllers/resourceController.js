import { getAvailability } from '../services/availabilityService.js';
import * as resources from '../services/resourceService.js';
import { created, ok, paginationMeta } from '../utils/respond.js';

export async function list(req, res) {
  const query = req.valid.query;
  const { items, total } = await resources.listResources(query, req.user);
  ok(res, items, 'Resources loaded', 200, paginationMeta(query.page, query.limit, total));
}

export async function locations(req, res) {
  ok(res, await resources.listLocations(req.user));
}

export async function detail(req, res) {
  const resource = await resources.getResource(req.params.resourceId, req.user);
  const data = resource.toObject();
  if (req.user.role !== 'ADMIN') {
    data.approvers = (data.approvers || []).map((a) => ({ _id: a._id, name: a.name }));
  }
  ok(res, data);
}

export async function availability(req, res) {
  const resource = await resources.getResource(req.params.resourceId, req.user);
  ok(res, await getAvailability(resource, req.valid.query.date, req.user));
}

export async function create(req, res) {
  created(res, await resources.createResource(req.valid.body, req.user), 'Resource created successfully');
}

export async function update(req, res) {
  ok(res, await resources.updateResource(req.params.resourceId, req.valid.body, req.user), 'Resource updated successfully');
}

export async function changeStatus(req, res) {
  const result = await resources.changeResourceStatus(req.params.resourceId, req.valid.body, req.user);
  const extra = result.cancelledBookings ? ` ${result.cancelledBookings} upcoming booking(s) cancelled.` : '';
  ok(res, result, `Resource status changed to ${result.resource.status}.${extra}`);
}

export async function addBlock(req, res) {
  created(res, await resources.addBlockedPeriod(req.params.resourceId, req.valid.body, req.user), 'Blocked period added');
}

export async function removeBlock(req, res) {
  ok(res, await resources.removeBlockedPeriod(req.params.resourceId, req.params.blockId, req.user), 'Blocked period removed');
}
