import { CheckerNode } from './checker.js';
import { CheckerConfig } from './config.js';
import { getLogger } from './logger.js';

import packageJson from '../package.json' with { type: 'json' };

const logger = getLogger('main');

process.on('unhandledRejection', (err) => {
  logger.error(err, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal(err, 'Uncaught exception');
});

async function main() {
  logger.info({ version: packageJson.version }, 'Starting Beamable.Network DePIN Checker Node');
  const config = new CheckerConfig();
  logger.debug({ network: config.solanaNetwork }, 'Loaded configuration');

  const checker = await CheckerNode.create(config);

  const shutdown = async () => {
    logger.info('Received shutdown signal, gracefully shutting down...');
    await checker.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await checker.start();
}

main().catch((error) => {
  logger.fatal(error, 'Fatal error starting checker');
  process.exit(1);
});
