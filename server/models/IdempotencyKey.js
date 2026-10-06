import mongoose from 'mongoose';

/**
 * Claim record for client-supplied Idempotency-Key headers. The unique
 * (user, scope, key) index ensures a retried or double-clicked request is
 * executed at most once; records expire automatically after 24 hours.
 */
const idempotencyKeySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  scope: { type: String, required: true },
  key: { type: String, required: true },
  status: { type: String, enum: ['IN_PROGRESS', 'COMPLETED'], default: 'IN_PROGRESS' },
  resultId: mongoose.Schema.Types.ObjectId,
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
});

idempotencyKeySchema.index({ user: 1, scope: 1, key: 1 }, { unique: true });

export const IdempotencyKey = mongoose.model('IdempotencyKey', idempotencyKeySchema);
