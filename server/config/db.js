import mongoose from 'mongoose';
import { env } from './env.js';
import { setTransactionSupport } from '../utils/transaction.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

/**
 * Connects to MongoDB and detects whether multi-document transactions are
 * available (replica set / sharded cluster such as Atlas). Booking conflict
 * safety never depends on transactions — see services/slotLockService.js —
 * but side effects are grouped atomically when the deployment supports it.
 */
export async function connectDatabase(uri = env.MONGO_URI) {
  await mongoose.connect(uri, { autoIndex: true });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  const supportsTransactions = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  setTransactionSupport(supportsTransactions);
  await mongoose.connection.syncIndexes();
  logger.info(
    `MongoDB connected (${mongoose.connection.name}); transactions ${supportsTransactions ? 'enabled' : 'unavailable (standalone server)'}`,
  );
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
