import { Address, KeyPairSigner } from 'gill';
import { CheckerConfig } from './config.js';
import { getLogger } from './logger.js';
import { CheckerService } from './services/checker-service.js';
import { RpcClient } from './utils/rpc-client.js';

const logger = getLogger('CheckerNode');

export interface CheckerNodeProps {
  signer: KeyPairSigner;
  rpc: RpcClient;
  config: CheckerConfig;
  license: CheckerLicenseContext;
}

export interface CheckerLogContext {
  checkerAddress: Address;
  licenseAddress: Address;
}

export interface CheckerLicenseContext {
  address: Address;
  index: number;
}

export class CheckerNode {
  checkerService: CheckerService;
  public readonly license: CheckerLicenseContext;

  private readonly signer: KeyPairSigner;
  private readonly rpc: RpcClient;
  private readonly config: CheckerConfig;
  private readonly logContext: CheckerLogContext;

  constructor(props: CheckerNodeProps) {
    this.signer = props.signer;
    this.rpc = props.rpc;
    this.config = props.config;
    this.license = props.license;
    this.logContext = {
      checkerAddress: this.signer.address,
      licenseAddress: this.license.address
    };
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

  getLogContext() {
    return { checker: this.logContext };
  }

  async start(): Promise<void> {
    logger.info(this.getLogContext(), 'Checker node starting');

    if (this.skipBrand()) {
      logger.warn(this.getLogContext(), 'Skipping BRAND eligibility checks as per configuration. This is NOT recommended for production environments.');
    }

    this.checkerService.start();
  }

  async stop(): Promise<void> {
    logger.info(this.getLogContext(), 'Checker node stopping...');
    this.checkerService.stop();
  }
}