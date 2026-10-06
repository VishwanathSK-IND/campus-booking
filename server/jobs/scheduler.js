import cron from 'node-cron';
import { env } from '../config/env.js';
import {
  cleanupOrphanLocks,
  completeBookings,
  expirePendingApprovals,
  markNoShows,
  sendReminders,
} from '../services/lifecycleService.js';
import { expireWaitlist, promoteAllWaitlists } from '../services/waitlistService.js';
import { clock } from '../utils/clock.js';
import { logger } from '../utils/logger.js';

/** Order matters: expire/no-show first so released time can be offered to waitlists in the same tick. */
export const JOBS = {
  expirePendingApprovals,
  markNoShows,
  completeBookings,
  expireWaitlist,
  promoteWaitlists: () => promoteAllWaitlists(),
  sendReminders,
  cleanupOrphanLocks,
};

let running = false;
let task = null;

/** Runs every job once. Re-entrancy guarded within a process; idempotent across processes. */
export async function runAllJobs() {
  if (running) return { skipped: true };
  running = true;
  const results = {};
  try {
    for (const [name, job] of Object.entries(JOBS)) {
      try {
        results[name] = await job(clock.now());
      } catch (error) {
        results[name] = { error: error.message };
        logger.error(`Job ${name} failed`, error);
      }
    }
  } finally {
    running = false;
  }
  const changed = Object.entries(results).filter(([, r]) => r && Object.values(r).some((v) => typeof v === 'number' && v > 0));
  if (changed.length) logger.info('Jobs:', JSON.stringify(Object.fromEntries(changed)));
  return results;
}

export function startScheduler() {
  if (!env.JOBS_ENABLED) {
    logger.info('Background jobs disabled (JOBS_ENABLED=false)');
    return;
  }
  task = cron.schedule(env.JOBS_CRON, () => {
    runAllJobs().catch((error) => logger.error('Job tick failed', error));
  });
  logger.info(`Background jobs scheduled (${env.JOBS_CRON})`);
}

export function stopScheduler() {
  task?.stop();
  task = null;
}
