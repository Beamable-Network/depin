import { CheckerNode } from './checker.js';
import { CheckerConfig } from './config.js';
import { getLogger } from './logger.js';
import { HealthServer } from './health-server.js';
import { LicenseDiscoveryService, DiscoveredLicense } from './services/license-discovery-service.js';

import { createKeyPairSignerFromBytes, KeyPairSigner, Address } from 'gill';
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
// Checker Node Management
// =============================================================================

function makeCheckerNodeFactory(
  signer: KeyPairSigner,
  rpc: RpcClient,
  config: CheckerConfig
): (license: DiscoveredLicense) => Promise<CheckerNode> {
  return async (license: DiscoveredLicense): Promise<CheckerNode> => {
    logger.info(
      {
        licenseIndex: license.index,
        licenseAddress: license.address,
        checkerAddress: signer.address
      },
      'Creating checker node'
    );

    const checker = new CheckerNode({
      version: packageJson.version,
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
  };
}

function setupShutdownHandlers(
  licenseService: LicenseDiscoveryService,
  healthServer: HealthServer
): void {
  const shutdown = async () => {
    const checkers = licenseService.getCurrentCheckers();
    logger.info({ activeCheckers: checkers.length }, 'Received shutdown signal, gracefully shutting down...');

    healthServer.stop();
    licenseService.stopMonitoring();
    await licenseService.stopAllCheckers();

    logger.info('Shutdown complete');
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
      configuredOwners: config.checkerOwners.length,
      skipBrand: config.skipBrand
    },
    'Configuration loaded'
  );

  // Initialize signer and RPC client
  const signer = await createKeyPairSignerFromBytes(config.checkerPrivateKeyBytes);
  logger.info({ checkerAddress: signer.address }, 'Checker identity initialized');

  const rpc = createRpcClient(signer, config);

  // Initialize license discovery service
  const licenseService = new LicenseDiscoveryService({
    signer,
    rpc,
    config,
    version: packageJson.version,
    createCheckerNode: makeCheckerNodeFactory(signer, rpc, config)
  });

  // Perform initial license discovery and start checker nodes
  await licenseService.initializeCheckers();

  // Setup graceful shutdown
  setupShutdownHandlers(licenseService, healthServer);

  // Start background monitoring for license changes
  licenseService.startMonitoring();
}

// =============================================================================
// Application Bootstrap
// =============================================================================

main().catch((error) => {
  logger.fatal(error, 'Fatal error starting checker');
  process.exit(1);
});
