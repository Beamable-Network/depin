import { getAssetWithProof } from '@metaplex-foundation/mpl-bubblegum';
import { publicKey } from '@metaplex-foundation/umi';
import { address, Address, createKeyPairSignerFromBytes, isAddress, KeyPairSigner, lamportsToSol } from 'gill';
import { CheckerConfig } from './config.js';
import { createRpcClient, RpcClient } from './helpers/rpc-client.js';
import { getLogger } from './logger.js';
import { CheckerService } from './services/checker-service.js';
import { ActivateChecker, CheckerMetadataAccount } from '@beamable-network/depin';

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


    logger.info({ license: this.license }, 'Fetching checker license');
    const license = await getAssetWithProof(this.rpc.umi, publicKey(this.license));
    logger.info({ licenseIndex: license.index, licenseOwner: license.leafOwner }, 'Checker license');

    const checkerMetadataPda = await CheckerMetadataAccount.findCheckerMetadataPDA(this.license, checkerAddress);
    const checkerMetadataAccount = await this.rpc.umi.rpc.getAccount(publicKey(checkerMetadataPda[0]));

    if (!checkerMetadataAccount.exists && address(license.leafOwner) != checkerAddress) {
      throw new Error(`Checker license is owned by ${license.leafOwner}, but checker address is ${checkerAddress}. An activation can only be performed by the license owner.`);
    }

    // Activate the license
    if (!checkerMetadataAccount.exists) {
      logger.info('Activating checker license...');

      const activate = new ActivateChecker({
        checker_license: license,
        delegated_to: checkerAddress,
        signer: checkerAddress
      });

      const tx = await this.rpc.buildAndSendTransaction([await activate.getInstruction()], 'finalized')
      logger.info({ txSig: tx.signature }, 'Checker license activated');
    }
    else {
      const checkerMetadata = CheckerMetadataAccount.deserializeFrom(checkerMetadataAccount.data);
      if (checkerMetadata.delegatedTo !== checkerAddress) {
        throw new Error(`Checker license is delegated to ${checkerMetadata.delegatedTo}, but checker address is ${checkerAddress}.`);
      }
    }
    
    this.checkerService.start();
  }

  async stop(): Promise<void> {
    logger.info('Checker node stopping...');
    this.checkerService.stop();
  }
}
