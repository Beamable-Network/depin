import dotenv from 'dotenv';
import { isAddress, ReadonlyUint8Array } from 'gill';
import { dirname, join } from 'path';
import { getBase58Codec } from 'gill';

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
  public readonly checkerOwners: string[];
  public readonly skipBrand: boolean;
  public readonly throttle: {
    sendTransaction: ThrottleConfig;
    getProgramAccounts: ThrottleConfig;
    getAssetWithProof: ThrottleConfig;
    getAccount: ThrottleConfig;
  };

  private _checkerPrivateKeyBytes?: ReadonlyUint8Array;

  constructor() {
    const solanaNetwork = process.env.SOLANA_NETWORK;
    const heliusApiKey = process.env.HELIUS_API_KEY;
    const checkerPrivateKey = process.env.CHECKER_PRIVATE_KEY;
    const checkerLicenses = process.env.CHECKER_LICENSES;
    const checkerOwners = process.env.CHECKER_OWNERS;
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

    // At least one of CHECKER_LICENSES or CHECKER_OWNERS must be specified
    if (!checkerLicenses && !checkerOwners) {
      throw new Error('Either CHECKER_LICENSES or CHECKER_OWNERS (or both) must be specified');
    }

    this.solanaNetwork = solanaNetwork;
    this.checkerPrivateKey = checkerPrivateKey;

    // Parse and validate CHECKER_LICENSES if provided
    if (checkerLicenses) {
      this.checkerLicenses = checkerLicenses.split(',').map(l => l.trim()).filter(l => l.length > 0);

      if (this.checkerLicenses.length === 0) {
        throw new Error('CHECKER_LICENSES cannot be empty');
      }

      if (this.checkerLicenses.some(l => !isAddress(l))) {
        throw new Error('One or more CHECKER_LICENSES are not valid Solana addresses');
      }
    } else {
      this.checkerLicenses = [];
    }

    // Parse and validate CHECKER_OWNERS if provided
    if (checkerOwners) {
      this.checkerOwners = checkerOwners.split(',').map(o => o.trim()).filter(o => o.length > 0);

      if (this.checkerOwners.length === 0) {
        throw new Error('CHECKER_OWNERS cannot be empty');
      }

      if (this.checkerOwners.some(o => !isAddress(o))) {
        throw new Error('One or more CHECKER_OWNERS are not valid Solana addresses');
      }
    } else {
      this.checkerOwners = [];
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
      },
      getAccount: {
        limit: this.parseEnvInt('THROTTLE_GET_ACCOUNT_LIMIT', 8),
        interval: this.parseEnvInt('THROTTLE_GET_ACCOUNT_INTERVAL', 1100)
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

  get checkerPrivateKeyBytes(): ReadonlyUint8Array {
    if (this._checkerPrivateKeyBytes) {
      return this._checkerPrivateKeyBytes;
    }

    // Try base58 format first
    if (!this.checkerPrivateKey.startsWith('[')) {
      try {
        this._checkerPrivateKeyBytes = getBase58Codec().encode(this.checkerPrivateKey);
        if (this._checkerPrivateKeyBytes.length !== 64) {
          throw new Error(`Invalid base58 key length: ${this._checkerPrivateKeyBytes.length}, expected 64`);
        }
        return this._checkerPrivateKeyBytes;
      } catch (err) {
        throw new Error(`Invalid CHECKER_PRIVATE_KEY base58 format. Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Try JSON array format
    try {
      const secretKeyArray = JSON.parse(this.checkerPrivateKey);
      if (!Array.isArray(secretKeyArray) || secretKeyArray.length !== 64) {
        throw new Error('Invalid array format or length');
      }
      this._checkerPrivateKeyBytes = new Uint8Array(secretKeyArray);
      return this._checkerPrivateKeyBytes;
    } catch (err) {
      throw new Error(`Invalid CHECKER_PRIVATE_KEY format. Expected JSON array of 64 numbers from solana-keygen or base58 string. Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getSolanaRpcUrl(): string {
      return `https://${this.solanaNetwork}.helius-rpc.com/?api-key=${this.heliusApiKey}`;
  }
}
