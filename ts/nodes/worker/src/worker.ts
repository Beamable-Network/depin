import { address, Address, createKeyPairSignerFromBytes, isAddress, KeyPairSigner, lamportsToSol, SignableMessage, SignatureBytes } from 'gill';
import * as os from 'os';

import { DasApiInterface } from '@metaplex-foundation/digital-asset-standard-api';
import { getAssetWithProof } from '@metaplex-foundation/mpl-bubblegum';
import { publicKey, Umi } from '@metaplex-foundation/umi';
import { ActivateWorker, UpdateWorkerUri, WorkerMetadataAccount } from '@beamable-network/depin';
import { WorkerConfig } from './config.js';
import { createRpcClient, RpcClient } from './utils/rpc-client.js';
import { getLogger } from './logger.js';
import { ProofStorageService } from './services/proof-storage.js';

const logger = getLogger('WorkerNode');

export class WorkerNode {
  private readonly proofStorage: ProofStorageService;

  private constructor(
    private readonly signer: KeyPairSigner,
    private readonly license: Address,
    private readonly rpc: RpcClient,
    private readonly config: WorkerConfig
  ) {
    this.proofStorage = new ProofStorageService(config);
  }

  static async create(config: WorkerConfig): Promise<WorkerNode> {
    if (!isAddress(config.workerLicense)) {
      throw new Error('Invalid WORKER_LICENSE address format');
    }

    const signer = await createKeyPairSignerFromBytes(config.workerPrivateKeyBytes);
    const rpc = createRpcClient(signer, config);

    return new WorkerNode(signer, config.workerLicense, rpc, config);
  }

  async sign(message: SignableMessage): Promise<SignatureBytes> {
    const [signature] = await this.signer.signMessages([message]);
    return signature[this.signer.address];
  }

  getLicense(): Address {
    return this.license;
  }

  getUmi(): Umi & { rpc: DasApiInterface; } {
    return this.rpc.umi;
  }

  getRpcClient(): RpcClient {
    return this.rpc;
  }

  getAddress(): Address {
    return this.signer.address;
  }

  getSigner(): KeyPairSigner {
    return this.signer;
  }

  getProofStorage(): ProofStorageService {
    return this.proofStorage;
  }

  async getBalance(): Promise<bigint> {
    const balanceResponse = await this.rpc.umi.rpc.getBalance(publicKey(this.signer.address));
    return balanceResponse.basisPoints;
  }

  async healthCheck(): Promise<{ systemMetrics: any }> {
    const memUsage = process.memoryUsage();

    // Convert bytes to GB
    const memUsedGB = memUsage.rss / (1024 * 1024 * 1024);
    const memTotalGB = memUsage.heapTotal / (1024 * 1024 * 1024);

    return {
      systemMetrics: {
        uptime: process.uptime(),
        cpu: {
          usage: process.cpuUsage().user / 1000000, // Convert microseconds to seconds
          cores: os.cpus().length
        },
        memory: {
          used: memUsedGB,
          total: memTotalGB,
          percentage: (memUsedGB / memTotalGB) * 100
        }
      }
    };
  }

  async start(): Promise<void> {
    const workerAddress = this.getAddress();
    logger.info({ workerAddress }, 'Worker node starting');
    try {
      const balance = await this.getBalance();
      logger.info({ balanceLamports: balance, balanceSol: lamportsToSol(balance) }, 'Current balance');
      if (balance === 0n) {
        logger.warn('Worker has zero balance. Please fund the worker account to pay for transaction fees.');
      }
    } catch (err) {
      logger.warn(err, 'Could not fetch balance');
    }

    logger.info({ license: this.license }, 'Fetching worker license');
    const license = await getAssetWithProof(this.rpc.umi, publicKey(this.license));
    logger.info({ licenseIndex: license.index, licenseOwner: license.leafOwner }, 'Worker license');

    const workerMetadataPda = await WorkerMetadataAccount.findWorkerMetadataPDA(this.license, workerAddress);
    const workerMetadataAccount = await this.rpc.umi.rpc.getAccount(publicKey(workerMetadataPda[0]));

    // Activate the license
    if (!workerMetadataAccount.exists) {
      logger.info('Activating worker license...');

      const activation = new ActivateWorker({
        worker_license: license,
        delegated_to: workerAddress,
        discovery_uri: this.config.externalUrl,
        signer: workerAddress
      });

      const tx = await this.rpc.buildAndSendTransaction([await activation.getInstruction()], 'finalized')
      logger.info({ txSig: tx.signature }, 'Worker license activated');
    }
    else {
      const workerMetadata = WorkerMetadataAccount.deserializeFrom(workerMetadataAccount.data);

      if (workerMetadata.delegatedTo !== workerAddress) {
        if (workerAddress == address(license.leafOwner)) {
          // Reactivate the worker for the new delegate
          logger.info('Reactivating worker license for new delegate...');
          const reactivation = new ActivateWorker({
            worker_license: license,
            delegated_to: workerAddress,
            discovery_uri: this.config.externalUrl,
            signer: workerAddress
          });

          const tx = await this.rpc.buildAndSendTransaction([await reactivation.getInstruction()], 'finalized')
          logger.info({ txSig: tx.signature }, 'Worker license reactivated');
          workerMetadata.discoveryUri = this.config.externalUrl;
        }
        else
          throw new Error(`Worker license is delegated to ${workerMetadata.delegatedTo}, but worker address is ${workerAddress}.`);
      }

      // Update discovery URI if it has changed
      if (workerMetadata.discoveryUri !== this.config.externalUrl) {
        logger.info({ from: workerMetadata.discoveryUri, to: this.config.externalUrl }, 'Updating worker discovery URI');

        const updateWorkerUri = new UpdateWorkerUri({
          worker_license: license,
          discovery_uri: this.config.externalUrl,
          signer: workerAddress
        });
        const tx = await this.rpc.buildAndSendTransaction([await updateWorkerUri.getInstruction()], 'finalized')
        logger.info({ txSig: tx.signature }, 'Worker discovery URI updated');
      }
    }
  }

  async stop(): Promise<void> {
    logger.info('Worker node stopping...');
  }
}
