import { WorkerConfig } from './config.js';
import { WorkerServer } from './server.js';
import { createLogger } from './logger.js';

import packageJson from '../package.json' with { type: 'json' };

const logger = createLogger('main');

process.on('unhandledRejection', (err) => {
  logger.error(err, 'Unhandled promise rejection');
});
process.on('uncaughtException', (error) => {
  logger.fatal(error, 'Uncaught exception');
});

async function main() {
  logger.info({ version: packageJson.version }, 'Starting Beamable.Network DePIN Worker Node');
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
  logger.fatal(error, 'Fatal error starting worker');
  process.exit(1);
});
