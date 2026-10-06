import mongoose from 'mongoose';

/** Append-only trail of administrative and system actions. Never updated or deleted by the app. */
const auditLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // null = system job
  actorSnapshot: { name: String, role: String },
  action: { type: String, required: true },
  entityType: { type: String, required: true },
  entityId: { type: mongoose.Schema.Types.ObjectId },
  summary: { type: String, required: true },
  details: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
});

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
