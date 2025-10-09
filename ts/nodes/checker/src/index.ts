import { CheckerNode } from './checker.js';
import { CheckerConfig } from './config.js';
import { getLogger } from './logger.js';

import { CheckerMetadataAccount, getCheckerTree } from '@beamable-network/depin';
import { findLeafAssetIdPda } from '@metaplex-foundation/mpl-bubblegum';
import { address, Address, createKeyPairSignerFromBytes } from 'gill';
import packageJson from '../package.json' with { type: 'json' };
import { createRpcClient } from './utils/rpc-client.js';
import { publicKey } from '@metaplex-foundation/umi';
import { trace } from '@opentelemetry/api';

const logger = getLogger('main');

function getTracer() {
    return trace.getTracer('index');
}

process.on('unhandledRejection', (err) => {
  logger.error(err, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal(err, 'Uncaught exception');
});

async function main() {
  logger.info({ version: packageJson.version }, 'Starting Beamable.Network DePIN Checker Node');
  const config = new CheckerConfig();
  logger.info({ network: config.solanaNetwork, licenseCount: config.checkerLicenses.length }, 'Loaded configuration');

  const signer = await createKeyPairSignerFromBytes(config.checkerPrivateKeyBytes);
  const rpc = createRpcClient(signer, config);

  // Create multiple checker nodes (one per license)
  const checkers: CheckerNode[] = [];

  if (config.checkerLicenses.length) {
    // Create checkers from config
    logger.debug(`Provided ${config.checkerLicenses.length} checker licenses, creating nodes...`);
    for (let i = 0; i < config.checkerLicenses.length; i++) {
      const licenseAddress = config.checkerLicenses[i];
      buildCheckerInstance(i, address(licenseAddress), false);
    }
  }
  else {
    // No licenses provided, find all activated licenses where I'm the delegate
    logger.debug('No checker licenses provided, searching for activated licenses where I\'m the delegate...');
    const checkerAccounts = await getTracer().startActiveSpan("find-my-licenses", async span => {
      span.setAttribute('delegate', signer.address);
      const accounts = await CheckerMetadataAccount.getActiveAccountsByDelegate(
        rpc.getProgramAccounts,
        signer.address
      );
      span.end();
      return accounts;
    });
    if (!checkerAccounts.length) {
      logger.fatal('No active checker licenses found where I\'m the delegate, exiting...');
      process.exit(0);
    }
    const checkerTree = getCheckerTree(config.solanaNetwork);
    for (let i = 0; i < checkerAccounts.length; i++) {
      const account = checkerAccounts[i];
      const licenseAddress = findLeafAssetIdPda(rpc.umi, { leafIndex: account.data.licenseIndex, merkleTree: publicKey(checkerTree) });
      buildCheckerInstance(account.data.licenseIndex, address(licenseAddress[0]), true);
    }
  }

  const shutdown = async () => {
    logger.info('Received shutdown signal, gracefully shutting down...');
    await Promise.all(checkers.map(checker => checker.stop()));
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start all checker nodes concurrently
  await Promise.all(checkers.map(checker => checker.start()));

  function buildCheckerInstance(licenseIndex: number, licenseAddress: Address, skipLicenseValidation: boolean) {
    logger.info({ licenseIndex: licenseIndex, licenseAddress }, 'Creating checker node');
    const checker = new CheckerNode({
      signer,
      rpc,
      config,
      licenseAddress,
      licenseIndex: licenseIndex,
      licenseValidated: skipLicenseValidation
    });
    checkers.push(checker);
  }
}

main().catch((error) => {
  logger.fatal(error, 'Fatal error starting checker');
  process.exit(1);
});
