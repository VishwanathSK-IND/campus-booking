import { runAllJobs } from '../jobs/scheduler.js';
import { Resource } from '../models/Resource.js';
import { getAdminDashboard, getAnalytics } from '../services/analyticsService.js';
import { listAuditLogs } from '../services/auditService.js';
import { adminListBookings } from '../services/bookingService.js';
import { getPolicy, updatePolicy } from '../services/policyService.js';
import { createManualRestriction, liftRestriction } from '../services/restrictionService.js';
import * as users from '../services/userService.js';
import { created, ok, paginationMeta } from '../utils/respond.js';

export async function listUsers(req, res) {
  const query = req.valid.query;
  const { items, total } = await users.listUsers(query);
  ok(res, items, 'Users loaded', 200, paginationMeta(query.page, query.limit, total));
}

export async function userDetail(req, res) {
  ok(res, await users.getUserDetail(req.params.userId));
}

export async function createUser(req, res) {
  created(res, await users.createUser(req.valid.body, req.user), 'User created');
}

export async function updateUser(req, res) {
  ok(res, await users.updateUser(req.params.userId, req.valid.body, req.user), 'User updated');
}

export async function restrictUser(req, res) {
  created(res, await createManualRestriction(req.params.userId, req.valid.body, req.user), 'Restriction applied');
}

export async function liftUserRestriction(req, res) {
  ok(res, await liftRestriction(req.params.restrictionId, req.valid.body, req.user), 'Restriction lifted');
}

export async function listBookings(req, res) {
  const query = req.valid.query;
  const { items, total } = await adminListBookings(query);
  ok(res, items, 'Bookings loaded', 200, paginationMeta(query.page, query.limit, total));
}

/** Admins see campus-wide analytics; faculty only for the resources they are assigned to. */
export async function analytics(req, res) {
  const scope = req.user.role === 'ADMIN' ? null : await Resource.find({ approvers: req.user._id }).distinct('_id');
  ok(res, { ...(await getAnalytics(req.valid.query, scope)), scope: scope ? 'ASSIGNED_RESOURCES' : 'CAMPUS' });
}

export async function dashboard(_req, res) {
  ok(res, await getAdminDashboard());
}

export async function policy(_req, res) {
  ok(res, await getPolicy());
}

export async function savePolicy(req, res) {
  ok(res, await updatePolicy(req.valid.body, req.user), 'Policy updated');
}

export async function auditLogs(req, res) {
  const query = req.valid.query;
  const { items, total } = await listAuditLogs(query);
  ok(res, items, 'Audit log loaded', 200, paginationMeta(query.page, query.limit, total));
}

/** Runs the scheduled jobs immediately (useful to demonstrate no-show / waitlist processing). */
export async function runJobs(_req, res) {
  ok(res, await runAllJobs(), 'Background jobs executed');
}
