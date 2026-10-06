import { IdempotencyKey } from '../models/IdempotencyKey.js';
import { conflict } from '../utils/AppError.js';

/**
 * Executes `execute` at most once per (user, scope, key). A repeat of a
 * completed request returns the original result (replayed = true); a repeat
 * while the first is still running gets 409 REQUEST_IN_PROGRESS. A failed
 * request releases its key so the user can retry.
 */
export async function withIdempotency(user, scope, key, execute, loadResult) {
  if (!key) return { result: await execute(), replayed: false };

  const identity = { user: user._id, scope, key };
  try {
    await IdempotencyKey.create(identity);
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const existing = await IdempotencyKey.findOne(identity);
    if (existing?.status === 'COMPLETED' && existing.resultId) {
      const previous = await loadResult(existing.resultId);
      if (previous) return { result: previous, replayed: true };
    }
    throw conflict('REQUEST_IN_PROGRESS', 'This request is already being processed');
  }

  try {
    const result = await execute();
    await IdempotencyKey.updateOne(identity, { status: 'COMPLETED', resultId: result._id });
    return { result, replayed: false };
  } catch (error) {
    await IdempotencyKey.deleteOne({ ...identity, status: 'IN_PROGRESS' });
    throw error;
  }
}
