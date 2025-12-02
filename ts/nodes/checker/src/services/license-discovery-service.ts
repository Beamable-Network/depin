import { ActivateChecker, CheckerMetadataAccount, getCurrentPeriod, getCheckerTree, getRemainingTimeInPeriodMs } from '@beamable-network/depin';
import { findLeafAssetIdPda } from '@metaplex-foundation/mpl-bubblegum';
import { publicKey } from '@metaplex-foundation/umi';
import { trace } from '@opentelemetry/api';
import { address, Address, KeyPairSigner } from 'gill';
import { CheckerConfig } from '../config.js';
import { getLogger } from '../logger.js';
import { RpcClient } from '../utils/rpc-client.js';
import { CheckerNode } from '../checker.js';

const logger = getLogger('LicenseDiscoveryService');

function getTracer() {
  return trace.getTracer('LicenseDiscoveryService');
}

export interface DiscoveredLicense {
  index: number;
  address: Address;
}

export interface LicenseDiscoveryServiceProps {
  signer: KeyPairSigner;
  rpc: RpcClient;
  config: CheckerConfig;
  version: string;
  createCheckerNode: (license: DiscoveredLicense) => Promise<CheckerNode>;
}

export class LicenseDiscoveryService {
  private static readonly PERIOD_BUFFER_MS = 10_000; // 10 seconds buffer

  private readonly signer: KeyPairSigner;
  private readonly rpc: RpcClient;
  private readonly config: CheckerConfig;
  private readonly version: string;
  private readonly createCheckerNode: (license: DiscoveredLicense) => Promise<CheckerNode>;

  private currentCheckers: Map<Address, CheckerNode> = new Map(); // key: license address
  private currentPeriod = 0;
  private isMonitoring = false;

  constructor(props: LicenseDiscoveryServiceProps) {
    this.signer = props.signer;
    this.rpc = props.rpc;
    this.config = props.config;
    this.version = props.version;
    this.createCheckerNode = props.createCheckerNode;
  }

  // =============================================================================
  // License Validation & Activation
  // =============================================================================

  private async validateAndActivateLicense(
    licenseAddress: string
  ): Promise<DiscoveredLicense | null> {
    logger.debug({ licenseAddress }, 'Validating license...');

    try {
      const licenseAsset = await this.rpc.getLicenseWithProof(licenseAddress);
      const licenseOwner = address(licenseAsset.leafOwner);

      // Check if license needs activation
      const checkerMetadataPda = await CheckerMetadataAccount.findCheckerMetadataPDA(
        address(licenseAddress),
        licenseOwner
      );
      const checkerMetadataAccount = await this.rpc.getAccount(checkerMetadataPda[0]);

      // Validate ownership
      if (checkerMetadataAccount == null && licenseOwner !== this.signer.address) {
        logger.error(
          {
            licenseAddress,
            licenseIndex: licenseAsset.index,
            owner: licenseOwner,
            checkerAddress: this.signer.address
          },
          'License owned by different address. Activation requires license owner. Skipping.'
        );
        return null;
      }

      // Activate if needed
      if (checkerMetadataAccount == null) {
        logger.info(
          { licenseAddress, licenseIndex: licenseAsset.index, checkerAddress: this.signer.address },
          'Activating checker license...'
        );

        const activate = new ActivateChecker({
          checker_license: licenseAsset,
          delegated_to: this.signer.address,
          signer: this.signer.address
        });

        const tx = await this.rpc.buildAndSendTransaction([await activate.getInstruction()], 'finalized');
        logger.info(
          {
            txSig: tx.signature,
            licenseAddress,
            licenseIndex: licenseAsset.index,
            checkerAddress: this.signer.address
          },
          'Checker license activated successfully'
        );
      } else {
        // Validate delegation
        const checkerMetadata = CheckerMetadataAccount.deserializeFrom(checkerMetadataAccount);
        if (checkerMetadata.delegatedTo !== this.signer.address) {
          logger.error(
            {
              licenseAddress,
              licenseIndex: licenseAsset.index,
              delegatedTo: checkerMetadata.delegatedTo,
              checkerAddress: this.signer.address
            },
            'License delegated to different address. Skipping.'
          );
          return null;
        }
        logger.debug(
          { licenseAddress, licenseIndex: licenseAsset.index, checkerAddress: this.signer.address },
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
  // License Discovery Methods
  // =============================================================================

  private async discoverLicensesFromConfig(): Promise<DiscoveredLicense[]> {
    const totalCount = this.config.checkerLicenses.length;
    logger.info(
      { totalLicenses: totalCount, checkerAddress: this.signer.address },
      'Processing configured checker licenses'
    );

    const licenses: DiscoveredLicense[] = [];
    let processed = 0;

    for (const licenseAddress of this.config.checkerLicenses) {
      processed++;
      logger.debug(
        { progress: `${processed}/${totalCount}`, licenseAddress },
        'Processing license'
      );

      const license = await this.validateAndActivateLicense(licenseAddress);
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

  private async discoverLicensesByOwner(): Promise<DiscoveredLicense[]> {
    logger.info(
      { checkerAddress: this.signer.address, whitelistedOwners: this.config.checkerOwners, network: this.config.solanaNetwork },
      'Searching for activated licenses from whitelisted owners...'
    );

    const checkerAccounts = await getTracer().startActiveSpan('find-delegated-licenses', async (span) => {
      span.setAttribute('delegate', this.signer.address);
      const accounts = await CheckerMetadataAccount.getActiveAccountsByDelegate(
        this.rpc.getProgramAccounts,
        this.signer.address
      );
      span.end();
      return accounts;
    });

    if (!checkerAccounts.length) {
      logger.warn(
        { checkerAddress: this.signer.address },
        'No active checker licenses found where I\'m the delegate'
      );
      return [];
    }

    logger.info(
      {
        foundLicenses: checkerAccounts.length,
        checkerAddress: this.signer.address
      },
      'Found active checker licenses on-chain, filtering by whitelisted owners'
    );

    const checkerTree = getCheckerTree(this.config.solanaNetwork);
    const licenses: DiscoveredLicense[] = [];
    const ownerSet = new Set(this.config.checkerOwners);

    logger.debug({ merkleTree: checkerTree }, 'Resolving license addresses from on-chain accounts');

    for (const account of checkerAccounts) {
      const licenseAddress = findLeafAssetIdPda(this.rpc.umi, {
        leafIndex: account.data.licenseIndex,
        merkleTree: publicKey(checkerTree)
      });

      const license = {
        index: account.data.licenseIndex,
        address: address(licenseAddress[0])
      };

      // Get the license asset to check the owner
      try {
        const licenseAsset = await this.rpc.getLicenseWithProof(license.address);
        const licenseOwner = address(licenseAsset.leafOwner);

        // Only include if the owner is in the whitelist
        if (ownerSet.has(licenseOwner)) {
          licenses.push(license);
          logger.info(
            { licenseAddress: license.address, licenseIndex: license.index, owner: licenseOwner },
            'License from whitelisted owner accepted'
          );
        } else {
          logger.debug(
            { licenseAddress: license.address, licenseIndex: license.index, owner: licenseOwner },
            'License owner not in whitelist, skipping'
          );
        }
      } catch (err) {
        logger.error(
          { licenseAddress: license.address, err },
          'Error fetching license asset, skipping'
        );
      }
    }

    logger.info(
      { resolvedLicenses: licenses.length, totalFound: checkerAccounts.length },
      'Completed license discovery by owner'
    );

    return licenses;
  }

  // =============================================================================
  // Public API
  // =============================================================================

  async discoverLicenses(): Promise<DiscoveredLicense[]> {
    logger.info({ checkerAddress: this.signer.address }, 'Starting license discovery');

    // Discover licenses from both explicit licenses and whitelisted owners
    const licensesFromConfig = this.config.checkerLicenses.length > 0
      ? await this.discoverLicensesFromConfig()
      : [];

    const licensesFromOwners = this.config.checkerOwners.length > 0
      ? await this.discoverLicensesByOwner()
      : [];

    // Combine and deduplicate licenses
    const licenseMap = new Map<string, DiscoveredLicense>();

    for (const license of [...licensesFromConfig, ...licensesFromOwners]) {
      licenseMap.set(license.address, license);
    }

    const licenses = Array.from(licenseMap.values());

    logger.info(
      {
        validLicenses: licenses.length,
        licenseIndices: licenses.map(l => l.index)
      },
      'License discovery completed'
    );

    return licenses;
  }

  async initializeCheckers(): Promise<CheckerNode[]> {
    const licenses = await this.discoverLicenses();

    if (!licenses.length) {
      logger.fatal(
        {
          checkerAddress: this.signer.address,
          network: this.config.solanaNetwork,
          configuredLicenses: this.config.checkerLicenses.length,
          configuredOwners: this.config.checkerOwners.length
        },
        'No valid checker licenses found after validation, exiting'
      );
      process.exit(1);
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
      const checker = await this.createCheckerNode(license);
      checkers.push(checker);
      this.currentCheckers.set(license.address, checker);
    }

    logger.info(
      {
        totalCheckers: checkers.length,
        licenseIndices: licenses.map(l => l.index),
        checkerAddress: this.signer.address,
        network: this.config.solanaNetwork
      },
      'All checker nodes started successfully and ready'
    );

    return checkers;
  }

  startMonitoring(): void {
    if (this.isMonitoring) {
      logger.warn('License monitoring already running');
      return;
    }

    this.isMonitoring = true;
    this.currentPeriod = getCurrentPeriod();
    logger.info({ period: this.currentPeriod }, 'Starting license monitoring');

    this.monitoringLoop();
  }

  stopMonitoring(): void {
    this.isMonitoring = false;
    logger.info('Stopping license monitoring');
  }

  private async monitoringLoop(): Promise<void> {
    while (this.isMonitoring) {
      const period = getCurrentPeriod();

      if (period !== this.currentPeriod) {
        logger.info(
          {
            previousPeriod: this.currentPeriod,
            newPeriod: period,
            checkerAddress: this.signer.address
          },
          'Period changed, rediscovering licenses'
        );

        this.currentPeriod = period;

        try {
          await this.refreshCheckers();
        } catch (err) {
          logger.error({ err, period }, 'Error refreshing checkers, will retry next period');
        }
      }

      // Sleep until near the end of the period
      const remainingMs = getRemainingTimeInPeriodMs(this.currentPeriod);
      const sleepMs = remainingMs + LicenseDiscoveryService.PERIOD_BUFFER_MS;

      logger.debug(
        { period: this.currentPeriod, remainingMs, sleepMs },
        'Sleeping until next period'
      );

      await new Promise(resolve => setTimeout(resolve, sleepMs));
    }
  }

  private async refreshCheckers(): Promise<void> {
    logger.info({ currentCheckers: this.currentCheckers.size }, 'Refreshing checker licenses');

    // Discover current valid licenses
    const newLicenses = await this.discoverLicenses();
    const newLicenseSet = new Set(newLicenses.map(l => l.address));
    const oldLicenseSet = new Set(this.currentCheckers.keys());

    // Find licenses to remove (no longer valid)
    const toRemove: Address[] = [];
    for (const licenseAddress of oldLicenseSet) {
      if (!newLicenseSet.has(licenseAddress)) {
        toRemove.push(licenseAddress);
      }
    }

    // Find licenses to add (newly discovered)
    const toAdd: DiscoveredLicense[] = [];
    for (const license of newLicenses) {
      if (!oldLicenseSet.has(license.address)) {
        toAdd.push(license);
      }
    }

    logger.info(
      {
        currentCount: this.currentCheckers.size,
        newCount: newLicenses.length,
        toRemove: toRemove.length,
        toAdd: toAdd.length
      },
      'License refresh comparison'
    );

    // Stop and remove checkers for invalid licenses
    for (const licenseAddress of toRemove) {
      const checker = this.currentCheckers.get(licenseAddress);
      if (checker) {
        logger.info(
          {
            licenseAddress,
            licenseIndex: checker.license.index
          },
          'Stopping checker for removed license'
        );
        await checker.stop();
        this.currentCheckers.delete(licenseAddress);
      }
    }

    // Start new checkers for newly discovered licenses
    for (const license of toAdd) {
      logger.info(
        {
          licenseAddress: license.address,
          licenseIndex: license.index
        },
        'Starting checker for new license'
      );
      const checker = await this.createCheckerNode(license);
      this.currentCheckers.set(license.address, checker);
    }

    logger.info(
      {
        activeCheckers: this.currentCheckers.size,
        licenseIndices: Array.from(this.currentCheckers.values()).map(c => c.license.index)
      },
      'Checker refresh completed'
    );
  }

  getCurrentCheckers(): CheckerNode[] {
    return Array.from(this.currentCheckers.values());
  }

  async stopAllCheckers(): Promise<void> {
    logger.info({ checkersToStop: this.currentCheckers.size }, 'Stopping all checker nodes');

    const checkers = Array.from(this.currentCheckers.values());
    await Promise.all(checkers.map((checker) => {
      logger.debug(
        { licenseIndex: checker.license.index, licenseAddress: checker.license.address },
        'Stopping checker node'
      );
      return checker.stop();
    }));

    this.currentCheckers.clear();

    logger.info(
      { stoppedCheckers: checkers.length },
      'All checker nodes stopped successfully'
    );
  }
}
