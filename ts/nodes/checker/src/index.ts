import { CheckerLicenseContext, CheckerNode } from './checker.js';
import { CheckerConfig } from './config.js';
import { getLogger } from './logger.js';
import { HealthServer } from './health-server.js';

import { ActivateChecker, CheckerMetadataAccount, getCheckerTree } from '@beamable-network/depin';
import { findLeafAssetIdPda } from '@metaplex-foundation/mpl-bubblegum';
import { publicKey } from '@metaplex-foundation/umi';
import { trace } from '@opentelemetry/api';
import { address, Address, createKeyPairSignerFromBytes, KeyPairSigner } from 'gill';
import packageJson from '../package.json' with { type: 'json' };
import { createRpcClient, RpcClient } from './utils/rpc-client.js';

const logger = getLogger('main');

// =============================================================================
// Process Error Handlers
// =============================================================================

process.on('unhandledRejection', (err) => {
  logger.error(err, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal(err, 'Uncaught exception');
});

// =============================================================================
// License Validation & Activation
// =============================================================================

async function validateAndActivateLicense(
  licenseAddress: string,
  signer: KeyPairSigner,
  rpc: RpcClient
): Promise<CheckerLicenseContext | null> {
  logger.debug({ licenseAddress }, 'Validating license...');
  
  try {
    const licenseAsset = await rpc.getLicenseWithProof(licenseAddress);
    const licenseOwner = address(licenseAsset.leafOwner);

    // Check if license needs activation
    const checkerMetadataPda = await CheckerMetadataAccount.findCheckerMetadataPDA(
      address(licenseAddress),
      licenseOwner
    );
    const checkerMetadataAccount = await rpc.getAccount(checkerMetadataPda[0]);

    // Validate ownership
    if (checkerMetadataAccount == null && licenseOwner !== signer.address) {
      logger.error(
        { 
          licenseAddress, 
          licenseIndex: licenseAsset.index,
          owner: licenseOwner, 
          checkerAddress: signer.address 
        },
        'License owned by different address. Activation requires license owner. Skipping.'
      );
      return null;
    }

    // Activate if needed
    if (checkerMetadataAccount == null) {
      logger.info(
        { licenseAddress, licenseIndex: licenseAsset.index, checkerAddress: signer.address }, 
        'Activating checker license...'
      );

      const activate = new ActivateChecker({
        checker_license: licenseAsset,
        delegated_to: signer.address,
        signer: signer.address
      });

      const tx = await rpc.buildAndSendTransaction([await activate.getInstruction()], 'finalized');
      logger.info(
        { 
          txSig: tx.signature, 
          licenseAddress, 
          licenseIndex: licenseAsset.index,
          checkerAddress: signer.address 
        }, 
        'Checker license activated successfully'
      );
    } else {
      // Validate delegation
      const checkerMetadata = CheckerMetadataAccount.deserializeFrom(checkerMetadataAccount);
      if (checkerMetadata.delegatedTo !== signer.address) {
        logger.error(
          { 
            licenseAddress, 
            licenseIndex: licenseAsset.index,
            delegatedTo: checkerMetadata.delegatedTo, 
            checkerAddress: signer.address 
          },
          'License delegated to different address. Skipping.'
        );
        return null;
      }
      logger.debug(
        { licenseAddress, licenseIndex: licenseAsset.index, checkerAddress: signer.address },
        'License already activated and properly delegated'
      );
    }
    
    return {
      index: licenseAsset.index,
      address: address(licenseAddress)
    };
  } catch (err) {
    logger.error(
      { licenseAddress, err }, 
      'Error processing license. Skipping.'
    );
    return null;
  }
}

// =============================================================================
// License Discovery
// =============================================================================

async function discoverLicensesFromConfig(
  config: CheckerConfig,
  signer: KeyPairSigner,
  rpc: RpcClient
): Promise<Array<{ index: number; address: Address }>> {
  const totalCount = config.checkerLicenses.length;
  logger.info(
    { totalLicenses: totalCount, checkerAddress: signer.address }, 
    'Processing configured checker licenses'
  );

  const licenses: Array<{ index: number; address: Address }> = [];
  let processed = 0;

  for (const licenseAddress of config.checkerLicenses) {
    processed++;
    logger.debug(
      { progress: `${processed}/${totalCount}`, licenseAddress },
      'Processing license'
    );
    
    const license = await validateAndActivateLicense(licenseAddress, signer, rpc);
    if (license) {
      licenses.push(license);
      logger.info(
        { licenseAddress, licenseIndex: license.index, progress: `${licenses.length}/${totalCount}` },
        'License validated successfully'
      );
    }
  }

  const skipped = totalCount - licenses.length;
  logger.info(
    { 
      totalLicenses: totalCount, 
      validLicenses: licenses.length, 
      skippedLicenses: skipped
    },
    'Completed license discovery from config'
  );

  return licenses;
}

async function discoverLicensesFromChain(
  config: CheckerConfig,
  signer: KeyPairSigner,
  rpc: RpcClient
): Promise<Array<{ index: number; address: Address }>> {
  logger.info(
    { checkerAddress: signer.address, network: config.solanaNetwork }, 
    'No licenses configured, searching for activated licenses on-chain...'
  );

  const tracer = trace.getTracer('index');
  const checkerAccounts = await tracer.startActiveSpan('find-my-licenses', async (span) => {
    span.setAttribute('delegate', signer.address);
    const accounts = await CheckerMetadataAccount.getActiveAccountsByDelegate(
      rpc.getProgramAccounts,
      signer.address
    );
    span.end();
    return accounts;
  });

  if (!checkerAccounts.length) {
    logger.fatal(
      { checkerAddress: signer.address },
      'No active checker licenses found where I\'m the delegate'
    );
    return [];
  }

  logger.info(
    { 
      foundLicenses: checkerAccounts.length, 
      checkerAddress: signer.address
    }, 
    'Found active checker licenses on-chain'
  );

  const checkerTree = getCheckerTree(config.solanaNetwork);
  const licenses: Array<{ index: number; address: Address }> = [];

  logger.debug({ merkleTree: checkerTree }, 'Resolving license addresses from on-chain accounts');

  for (const account of checkerAccounts) {
    const licenseAddress = findLeafAssetIdPda(rpc.umi, {
      leafIndex: account.data.licenseIndex,
      merkleTree: publicKey(checkerTree)
    });
    const license = {
      index: account.data.licenseIndex,
      address: address(licenseAddress[0])
    };
    licenses.push(license);
    logger.debug(
      { licenseAddress: license.address, licenseIndex: license.index },
      'Resolved license address'
    );
  }

  logger.info(
    { resolvedLicenses: licenses.length },
    'Completed license discovery from chain'
  );

  return licenses;
}

// =============================================================================
// Checker Node Management
// =============================================================================

async function createCheckerNode(
  license: { index: number; address: Address },
  signer: KeyPairSigner,
  rpc: RpcClient,
  config: CheckerConfig
): Promise<CheckerNode> {
  logger.info(
    { 
      licenseIndex: license.index, 
      licenseAddress: license.address,
      checkerAddress: signer.address 
    }, 
    'Creating checker node'
  );

  const checker = new CheckerNode({
    signer,
    rpc,
    config,
    license: {
      address: license.address,
      index: license.index
    }
  });

  await checker.start();
  
  logger.info(
    { 
      licenseIndex: license.index, 
      licenseAddress: license.address,
      checkerAddress: signer.address
    },
    'Checker node started successfully'
  );
  
  return checker;
}

function setupShutdownHandlers(checkers: CheckerNode[], healthServer: HealthServer): void {
  const shutdown = async () => {
    logger.info({ activeCheckers: checkers.length }, 'Received shutdown signal, gracefully shutting down...');

    healthServer.stop();

    await Promise.all(checkers.map((checker) => {
      logger.debug(
        { licenseIndex: checker.license.index, licenseAddress: checker.license.address },
        'Stopping checker node'
      );
      return checker.stop();
    }));

    logger.info(
      { stoppedCheckers: checkers.length },
      'All checker nodes stopped successfully'
    );
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
  logger.info(
    { version: packageJson.version },
    'Starting Beamable.Network DePIN Checker Node'
  );

  // Initialize health server
  const healthServer = new HealthServer(3000);
  healthServer.start();

  // Initialize configuration
  const config = new CheckerConfig();
  logger.info(
    {
      network: config.solanaNetwork,
      configuredLicenses: config.checkerLicenses.length,
      skipBrand: config.skipBrand
    },
    'Configuration loaded'
  );

  // Initialize signer and RPC client
  const signer = await createKeyPairSignerFromBytes(config.checkerPrivateKeyBytes);
  logger.info({ checkerAddress: signer.address }, 'Checker identity initialized');

  const rpc = createRpcClient(signer, config);

  // Discover licenses (from config or on-chain)
  const licenses = config.checkerLicenses.length > 0
    ? await discoverLicensesFromConfig(config, signer, rpc)
    : await discoverLicensesFromChain(config, signer, rpc);

  if (!licenses.length) {
    logger.fatal(
      { checkerAddress: signer.address, network: config.solanaNetwork },
      'No valid checker licenses found, exiting'
    );
    process.exit(0);
  }

  logger.info(
    { 
      validLicenses: licenses.length,
      licenseIndices: licenses.map(l => l.index) 
    }, 
    'Starting checker nodes'
  );

  // Create and start all checker nodes
  const checkers: CheckerNode[] = [];
  for (let i = 0; i < licenses.length; i++) {
    const license = licenses[i];
    logger.info(
      { progress: `${i + 1}/${licenses.length}`, licenseIndex: license.index },
      'Initializing checker node'
    );
    const checker = await createCheckerNode(license, signer, rpc, config);
    checkers.push(checker);
  }

  logger.info(
    {
      totalCheckers: checkers.length,
      licenseIndices: licenses.map(l => l.index),
      checkerAddress: signer.address,
      network: config.solanaNetwork
    },
    'All checker nodes started successfully and ready'
  );

  // Setup graceful shutdown
  setupShutdownHandlers(checkers, healthServer);
}

// =============================================================================
// Application Bootstrap
// =============================================================================

main().catch((error) => {
  logger.fatal(error, 'Fatal error starting checker');
  process.exit(1);
});
