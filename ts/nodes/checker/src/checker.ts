import { ActivateChecker, CheckerMetadataAccount } from '@beamable-network/depin';
import { AssetWithProof, getAssetWithProof } from '@metaplex-foundation/mpl-bubblegum';
import { publicKey } from '@metaplex-foundation/umi';
import { address, Address, KeyPairSigner, lamportsToSol } from 'gill';
import { CheckerConfig } from './config.js';
import { getLogger } from './logger.js';
import { CheckerService } from './services/checker-service.js';
import { RpcClient } from './utils/rpc-client.js';

const logger = getLogger('CheckerNode');

export interface CheckerNodeProps {
  signer: KeyPairSigner;
  rpc: RpcClient;
  config: CheckerConfig;
  licenseAddress: Address;
  licenseIndex: number;
  licenseValidated: boolean;
}

export class CheckerNode {
  checkerService: CheckerService;
  license: AssetWithProof | undefined;

  public readonly licenseAddress: Address;
  public readonly licenseIndex: number;
  private readonly signer: KeyPairSigner;
  private readonly rpc: RpcClient;
  private readonly config: CheckerConfig;
  private licenseValidated: boolean;

  constructor(props: CheckerNodeProps) {
    this.signer = props.signer;
    this.rpc = props.rpc;
    this.config = props.config;
    this.licenseAddress = props.licenseAddress;
    this.licenseIndex = props.licenseIndex;
    this.licenseValidated = props.licenseValidated;
    this.checkerService = new CheckerService(this);
  }

  getAddress(): Address { return this.signer.address; }
  getNetwork(): "mainnet" | "devnet" { return this.config.solanaNetwork; }
  getSigner(): KeyPairSigner { return this.signer; }
  getRpcClient(): RpcClient { return this.rpc; }
  skipBrand(): boolean { return this.config.skipBrand; }

  async getBalance(): Promise<bigint> {
    const balanceResponse = await this.rpc.helius.getBalance(this.signer.address);
    return balanceResponse.value;
  }

  async start(): Promise<void> {
    const checkerAddress = this.licenseAddress;
    logger.info({ checkerAddress, licenseIndex: this.licenseIndex, licenseAddress: this.licenseAddress }, 'Checker node starting');

    if (this.skipBrand()) {
      logger.warn({ licenseIndex: this.licenseIndex }, 'Skipping BRAND eligibility checks as per configuration. This is NOT recommended for production environments.');
    }

    // Fetch and log the current balance
    try {
      const balance = await this.getBalance();
      logger.info({ licenseIndex: this.licenseIndex, balanceLamports: balance, balanceSol: lamportsToSol(balance) }, 'Current balance');
      if (balance === 0n) {
        logger.warn({ licenseIndex: this.licenseIndex }, 'Checker has zero balance. Please fund the checker account to pay for transaction fees.');
      }
    } catch (err) {
      logger.warn({ err, licenseIndex: this.licenseIndex }, 'Could not fetch balance');
    }

    if (!this.licenseValidated) {
      // Fetch and validate the checker license
      logger.info({ licenseIndex: this.licenseIndex, licenseAddress: this.licenseAddress }, 'Fetching checker license');
      let license: AssetWithProof;
      try {
        license = await getAssetWithProof(this.rpc.umi, publicKey(this.licenseAddress));
        logger.info({ licenseIndex: this.licenseIndex, assetIndex: license.index, licenseOwner: license.leafOwner }, 'Checker license');
      }
      catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to fetch checker license ${this.licenseAddress}: ${errorMessage}`);
      }

      const checkerMetadataPda = await CheckerMetadataAccount.findCheckerMetadataPDA(address(license.rpcAsset.id), checkerAddress);
      const checkerMetadataAccount = await this.rpc.helius.getAccountInfo(checkerMetadataPda[0]);

      if (checkerMetadataAccount.value == null && address(license.leafOwner) != checkerAddress) {
        throw new Error(`Checker license is owned by ${license.leafOwner}, but checker address is ${checkerAddress}. An activation can only be performed by the license owner.`);
      }

      if (!checkerMetadataAccount.value) {
        // Activate the license
        logger.info({ licenseIndex: this.licenseIndex }, 'Activating checker license...');

        const activate = new ActivateChecker({
          checker_license: license,
          delegated_to: checkerAddress,
          signer: checkerAddress
        });

        const tx = await this.rpc.buildAndSendTransaction([await activate.getInstruction()], 'finalized')
        logger.info({ licenseIndex: this.licenseIndex, txSig: tx.signature }, 'Checker license activated');
      }
      else {
        const checkerMetadata = CheckerMetadataAccount.deserializeFrom(checkerMetadataAccount.value.data);
        if (checkerMetadata.delegatedTo !== checkerAddress) {
          throw new Error(`Checker license is delegated to ${checkerMetadata.delegatedTo}, but checker address is ${checkerAddress}.`);
        }
      }

      this.licenseValidated = true;
    }

    this.checkerService.start();
  }

  async stop(): Promise<void> {
    logger.info({ licenseIndex: this.licenseIndex }, 'Checker node stopping...');
    this.checkerService.stop();
  }
}