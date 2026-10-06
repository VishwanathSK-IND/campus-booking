import mongoose from 'mongoose';
import { logger } from './logger.js';

let transactionsSupported = false;

export function setTransactionSupport(value) {
  transactionsSupported = Boolean(value);
}

export function supportsTransactions() {
  return transactionsSupported;
}

/**
 * Runs a unit of work atomically when the MongoDB deployment supports
 * transactions. On a standalone server the work runs without a session and
 * the optional `compensate` callback undoes partial writes on failure.
 *
 * `ctx.afterCommit(fn)` registers side effects (socket emits, follow-up
 * processing) that must only happen once the data is durably written.
 */
export async function runInTransaction(work, { compensate } = {}) {
  let afterCommit = [];
  const ctx = {
    session: null,
    afterCommit: (fn) => afterCommit.push(fn),
  };

  let result;
  if (transactionsSupported) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        afterCommit = []; // the callback may be retried on transient errors
        ctx.session = session;
        result = await work(ctx);
      });
    } finally {
      await session.endSession();
    }
  } else {
    try {
      result = await work(ctx);
    } catch (error) {
      if (compensate) {
        try {
          await compensate();
        } catch (compensationError) {
          logger.error('Compensation failed', compensationError);
        }
      }
      throw error;
    }
  }

  for (const fn of afterCommit) {
    try {
      await fn();
    } catch (error) {
      // Post-commit effects (sockets, waitlist processing) must never undo a committed change.
      logger.error('afterCommit handler failed', error);
    }
  }
  return result;
}
