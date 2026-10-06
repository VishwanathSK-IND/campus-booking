import { AuditLog } from '../models/AuditLog.js';

/** Appends an audit entry. actor = null records an automated (system/job) action. */
export async function audit({ actor, action, entityType, entityId, summary, details }, ctx) {
  const [entry] = await AuditLog.create(
    [
      {
        actor: actor?._id ?? null,
        actorSnapshot: actor ? { name: actor.name, role: actor.role } : { name: 'System', role: 'SYSTEM' },
        action,
        entityType,
        entityId,
        summary,
        details,
      },
    ],
    { session: ctx?.session ?? null },
  );
  return entry;
}

export async function listAuditLogs({ page, limit, action, entityType, entityId }) {
  const filter = {};
  if (action) filter.action = action;
  if (entityType) filter.entityType = entityType;
  if (entityId) filter.entityId = entityId;
  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);
  return { items, total };
}
