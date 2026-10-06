import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { emitToUser } from '../sockets/io.js';
import { logger } from '../utils/logger.js';

function emitCreated(doc) {
  emitToUser(doc.user, 'notification.created', {
    _id: String(doc._id),
    type: doc.type,
    title: doc.title,
    message: doc.message,
    booking: doc.booking ? String(doc.booking) : undefined,
    createdAt: doc.createdAt,
  });
}

/**
 * Persists a notification as part of the caller's unit of work. The real-time
 * push is deferred until after commit (ctx.afterCommit) so clients are never
 * told about data that was rolled back.
 */
export async function notify(input, ctx) {
  const [doc] = await Notification.create([input], { session: ctx?.session ?? null });
  if (ctx?.afterCommit) ctx.afterCommit(() => emitCreated(doc));
  else emitCreated(doc);
  return doc;
}

export async function notifyMany(inputs, ctx) {
  const docs = [];
  for (const input of inputs) docs.push(await notify(input, ctx));
  return docs;
}

/**
 * Idempotent notification for background jobs: the unique dedupeKey index
 * guarantees one notification per key even if the job runs twice.
 */
export async function notifyOnce(input) {
  if (!input.dedupeKey) throw new Error('notifyOnce requires a dedupeKey');
  try {
    const doc = await Notification.create(input);
    emitCreated(doc);
    return doc;
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
}

/** Approval requests go to the resource's assigned approvers, or to all admins if none are assigned. */
export async function approverRecipients(resource) {
  if (resource.approvers?.length) {
    const approvers = await User.find({ _id: { $in: resource.approvers }, isActive: true }).select('_id');
    if (approvers.length) return approvers.map((u) => u._id);
  }
  const admins = await User.find({ role: 'ADMIN', isActive: true }).select('_id');
  return admins.map((u) => u._id);
}

/** Best-effort wrapper for non-critical notifications outside a unit of work. */
export async function safeNotify(input) {
  try {
    return await notify(input);
  } catch (error) {
    logger.error('Notification failed', error);
    return null;
  }
}
