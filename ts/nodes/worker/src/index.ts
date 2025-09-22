import { WorkerConfig } from './config.js';
import { WorkerServer } from './server.js';
import { createLogger } from './logger.js';

const logger = createLogger('main');

// Global process error handlers for better diagnostics
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception');
});

async function main() {
  logger.info('Starting worker process');
  const config = new WorkerConfig();
  logger.debug({ env: config.environment, host: config.host, port: config.port, externalUrl: config.externalUrl }, 'Loaded configuration');
  const server = await WorkerServer.create(config);

  const shutdown = async () => {
    logger.info('Received shutdown signal, gracefully shutting down...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.start();
}

main().catch((error) => {
  logger.fatal({ error }, 'Fatal error starting worker');
  process.exit(1);
});
