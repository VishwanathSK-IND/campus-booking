import http from 'node:http';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

async function start() {
  await connectDatabase();
  const app = createApp();
  const server = http.createServer(app);

  server.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));

  const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down`);
    server.close();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((error) => {
  logger.error('Failed to start server', error);
  process.exit(1);
});
