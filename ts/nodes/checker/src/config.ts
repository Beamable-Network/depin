import dotenv from 'dotenv';
import { isAddress } from 'gill';
import { dirname, join } from 'path';

const checkerDir = dirname(import.meta.dirname);
const envPath = join(checkerDir, '.env');
dotenv.config({ path: envPath });

export interface ThrottleConfig {
  limit: number;
  interval: number;
}

export class CheckerConfig {
  public readonly solanaNetwork: "mainnet" | "devnet";
  public readonly heliusApiKey: string;
  public readonly checkerPrivateKey: string;
  public readonly checkerLicenses: string[];
  public readonly skipBrand: boolean;
  public readonly throttle: {
    sendTransaction: ThrottleConfig;
    getProgramAccounts: ThrottleConfig;
    getAssetWithProof: ThrottleConfig;
  };

  private _checkerPrivateKeyBytes?: Uint8Array;

  constructor() {
    const solanaNetwork = process.env.SOLANA_NETWORK;
    const heliusApiKey = process.env.HELIUS_API_KEY;
    const checkerPrivateKey = process.env.CHECKER_PRIVATE_KEY;
    const checkerLicenses = process.env.CHECKER_LICENSES || '';
    const skipBrand = process.env.SKIP_BRAND;

    if (!solanaNetwork) {
      throw new Error('SOLANA_NETWORK environment variable is required');
    }

    if (solanaNetwork !== 'mainnet' && solanaNetwork !== 'devnet') {
      throw new Error('SOLANA_NETWORK must be either "mainnet" or "devnet"');
    }

    if (!heliusApiKey) {
      throw new Error('HELIUS_API_KEY environment variable is required');
    }

    if (!checkerPrivateKey) {
      throw new Error('CHECKER_PRIVATE_KEY environment variable is required');
    }

    this.solanaNetwork = solanaNetwork;
    this.checkerPrivateKey = checkerPrivateKey;
    
    this.checkerLicenses = checkerLicenses.split(',').map(l => l.trim()).filter(l => l.length > 0);
    if (this.checkerLicenses.length > 0 && this.checkerLicenses.some(l => !isAddress(l))) {
      throw new Error('One or more CHECKER_LICENSES are not valid Solana addresses');
    }

    this.heliusApiKey = heliusApiKey;
    this.skipBrand = skipBrand === 'true' || skipBrand === '1';

    // Throttle configuration with defaults
    this.throttle = {
      sendTransaction: {
        limit: this.parseEnvInt('THROTTLE_SEND_TX_LIMIT', 1),
        interval: this.parseEnvInt('THROTTLE_SEND_TX_INTERVAL', 1100)
      },
      getProgramAccounts: {
        limit: this.parseEnvInt('THROTTLE_GET_ACCOUNTS_LIMIT', 5),
        interval: this.parseEnvInt('THROTTLE_GET_ACCOUNTS_INTERVAL', 1100)
      },
      getAssetWithProof: {
        limit: this.parseEnvInt('THROTTLE_GET_ASSET_LIMIT', 1),
        interval: this.parseEnvInt('THROTTLE_GET_ASSET_INTERVAL', 600)
      }
    };
  }

  private parseEnvInt(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (!value) {
      return defaultValue;
    }
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed <= 0) {
      throw new Error(`${key} must be a positive integer, got: ${value}`);
    }
    return parsed;
  }

  get checkerPrivateKeyBytes(): Uint8Array {
    if (this._checkerPrivateKeyBytes) {
      return this._checkerPrivateKeyBytes;
    }

    try {
      const secretKeyArray = JSON.parse(this.checkerPrivateKey);
      if (!Array.isArray(secretKeyArray) || secretKeyArray.length !== 64) {
        throw new Error('Invalid array format or length');
      }
      this._checkerPrivateKeyBytes = new Uint8Array(secretKeyArray);
      return this._checkerPrivateKeyBytes;
    } catch (err) {
      throw new Error(`Invalid CHECKER_PRIVATE_KEY format. Expected JSON array of 64 numbers from solana-keygen grind. Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getSolanaRpcUrl(): string {
      return `https://${this.solanaNetwork}.helius-rpc.com/?api-key=${this.heliusApiKey}`;
  }
}
