import { ActivateChecker, CheckerMetadataAccount } from '@beamable-network/depin';
import { AssetWithProof, getAssetWithProof } from '@metaplex-foundation/mpl-bubblegum';
import { publicKey } from '@metaplex-foundation/umi';
import { address, Address, createKeyPairSignerFromBytes, isAddress, KeyPairSigner, lamportsToSol } from 'gill';
import { CheckerConfig } from './config.js';
import { createRpcClient, RpcClient } from './helpers/rpc-client.js';
import { getLogger } from './logger.js';
import { CheckerService } from './services/checker-service.js';

const logger = getLogger('CheckerNode');

export class CheckerNode {
  checkerService: CheckerService;
  license: AssetWithProof | undefined;

  private constructor(
    private readonly signer: KeyPairSigner,
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
    return new CheckerNode(signer, rpc, config);
  }

  getLicense(): AssetWithProof | undefined { return this.license; }
  getAddress(): Address { return this.signer.address; }
  getSigner(): KeyPairSigner { return this.signer; }
  getRpcClient(): RpcClient { return this.rpc; }

  async getBalance(): Promise<bigint> {
    const balanceResponse = await this.rpc.helius.getBalance(this.signer.address);
    return balanceResponse.value;
  }

  async start(): Promise<void> {
    const checkerAddress = this.getAddress();
    logger.info({ checkerAddress }, 'Checker node starting');

    // Fetch and log the current balance
    try {
      const balance = await this.getBalance();
      logger.info({ balanceLamports: balance, balanceSol: lamportsToSol(balance) }, 'Current balance');
      if (balance === 0n) {
        logger.warn('Checker has zero balance. Please fund the checker account to pay for transaction fees.');
      }
    } catch (err) {
      logger.warn(err, 'Could not fetch balance');
    }

    // Fetch and validate the checker license
    logger.info({ license: this.license }, 'Fetching checker license');
    let license: AssetWithProof;
    try {
      license = await getAssetWithProof(this.rpc.umi, publicKey(this.config.checkerLicense));
      this.license = license;
      logger.info({ licenseIndex: license.index, licenseOwner: license.leafOwner }, 'Checker license');
    }
    catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to fetch checker license ${this.license}: ${errorMessage}`);
    }

    const checkerMetadataPda = await CheckerMetadataAccount.findCheckerMetadataPDA(address(this.license.rpcAsset.id), checkerAddress);
    const checkerMetadataAccount = await this.rpc.helius.getAccountInfo(checkerMetadataPda[0]);

    if (!checkerMetadataAccount.value?.data.length) {
      throw new Error(`Checker metadata account does not exist for license ${this.license} and checker ${checkerAddress}. Please activate the checker license.`);
    }

    if (checkerMetadataAccount.value == null && address(license.leafOwner) != checkerAddress) {
      throw new Error(`Checker license is owned by ${license.leafOwner}, but checker address is ${checkerAddress}. An activation can only be performed by the license owner.`);
    }

    // Activate the license
    if (checkerMetadataAccount.value == null) {
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
      const checkerMetadata = CheckerMetadataAccount.deserializeFrom(checkerMetadataAccount.value.data);
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
