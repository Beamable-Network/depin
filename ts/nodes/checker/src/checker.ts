import { getAssetWithProof } from '@metaplex-foundation/mpl-bubblegum';
import { publicKey } from '@metaplex-foundation/umi';
import { address, Address, createKeyPairSignerFromBytes, isAddress, KeyPairSigner, lamportsToSol } from 'gill';
import { CheckerConfig } from './config.js';
import { createRpcClient, RpcClient } from './helpers/rpc-client.js';
import { getLogger } from './logger.js';
import { CheckerService } from './services/checker-service.js';

const logger = getLogger('CheckerNode');

export class CheckerNode {
  checkerService: CheckerService;

  private constructor(
    private readonly signer: KeyPairSigner,
    private readonly license: Address,
    private readonly rpc: RpcClient,
    private readonly config: CheckerConfig
  ) {
    this.checkerService = new CheckerService(this);
  }

  static async create(config: CheckerConfig): Promise<CheckerNode> {
    if (!isAddress(config.checkerLicense)) {
      throw new Error('Invalid CHECKER_LICENSE address format');
    }

    const signer = await createKeyPairSignerFromBytes(config.checkerPrivateKeyBytes);
    const rpc = createRpcClient(signer, config);
    return new CheckerNode(signer, config.checkerLicense, rpc, config);
  }

  getLicense(): Address { return this.license; }
  getAddress(): Address { return this.signer.address; }
  getSigner(): KeyPairSigner { return this.signer; }
  getRpcClient(): RpcClient { return this.rpc; }
  getUmi() { return this.rpc.umi; }

  async getBalance(): Promise<bigint> {
    const balanceResponse = await this.rpc.umi.rpc.getBalance(publicKey(this.signer.address));
    return balanceResponse.basisPoints;
  }

  async start(): Promise<void> {
    const checkerAddress = this.getAddress();
    logger.info({ checkerAddress }, 'Checker node starting');
    try {
      const balance = await this.getBalance();
      logger.info({ balanceLamports: balance, balanceSol: lamportsToSol(balance) }, 'Current balance');
      if (balance === 0n) {
        logger.warn('Checker has zero balance. Please fund the checker account to pay for transaction fees.');
      }
    } catch (err) {
      logger.warn(err, 'Could not fetch balance');
    }

    // Validate that the checker license asset exists and is readable
    try {
      const asset = await getAssetWithProof(this.rpc.umi, publicKey(this.license));
      logger.debug({ licenseIndex: asset.index, owner: asset.leafOwner }, 'Checker license asset loaded');
      if (address(asset.leafOwner) !== checkerAddress) {
        logger.info({ delegatedTo: asset.leafOwner, checkerAddress }, 'Checker license may be delegated');
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to read checker license asset');
    }

    this.checkerService.start();
  }

  async stop(): Promise<void> {
    logger.info('Checker node stopping...');
    this.checkerService.stop();
  }
}
