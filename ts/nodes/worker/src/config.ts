import dotenv from 'dotenv';
import { getBase58Codec, isAddress, ReadonlyUint8Array } from 'gill';
import { dirname, join } from 'path';

const workerDir = dirname(import.meta.dirname);
const envPath = join(workerDir, '.env');
dotenv.config({ path: envPath });

export interface ThrottleConfig {
  limit: number;
  interval: number;
}

export class WorkerConfig {
  public readonly solanaNetwork: "mainnet" | "devnet";
  public readonly port: number;
  public readonly host: string;
  public readonly heliusApiKey: string;
  public readonly workerPrivateKey: string;
  public readonly workerLicense: string;
  public readonly externalUrl: string;
  public readonly basePath: URL;
  public readonly s3Config: {
    bucketName: string;
    bucketPath: string;
    region: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  public readonly throttle: {
    sendTransaction: ThrottleConfig;
    searchAssets: ThrottleConfig;
  };
  private _workerPrivateKeyBytes?: ReadonlyUint8Array;

  constructor() {
    const solanaNetwork = process.env.SOLANA_NETWORK;
    const heliusApiKey = process.env.HELIUS_API_KEY;
    const externalUrl = process.env.EXTERNAL_URL;
    const workerPrivateKey = process.env.WORKER_PRIVATE_KEY;
    const workerLicense = process.env.WORKER_LICENSE;
    const s3BucketName = process.env.S3_BUCKET_NAME;
    const s3Region = process.env.S3_REGION;

    if (!solanaNetwork) {
      throw new Error('SOLANA_NETWORK environment variable is required');
    }

    if (solanaNetwork !== 'mainnet' && solanaNetwork !== 'devnet') {
      throw new Error('SOLANA_NETWORK must be either "mainnet" or "devnet"');
    }

    if (!heliusApiKey) {
      throw new Error('HELIUS_API_KEY environment variable is required');
    }

    if (!externalUrl) {
      throw new Error('EXTERNAL_URL environment variable is required');
    }

    if (!workerPrivateKey) {
      throw new Error('WORKER_PRIVATE_KEY environment variable is required');
    }

    if (!workerLicense) {
      throw new Error('WORKER_LICENSE environment variable is required');
    }

    if (!s3BucketName) {
      throw new Error('S3_BUCKET_NAME environment variable is required');
    }

    if (!s3Region) {
      throw new Error('S3_REGION environment variable is required');
    }

    this.solanaNetwork = solanaNetwork;
    this.port = parseInt(process.env.PORT || '3000');
    this.host = process.env.HOST || '0.0.0.0';
    this.heliusApiKey = heliusApiKey;
    this.workerPrivateKey = workerPrivateKey;
    this.workerLicense = workerLicense;
    this.externalUrl = externalUrl;
    this.basePath = new URL(externalUrl);
    this.s3Config = {
      bucketName: s3BucketName,
      bucketPath: process.env.S3_BUCKET_PATH || '',
      region: s3Region,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
    };

    // Throttle configuration with defaults
    this.throttle = {
      sendTransaction: {
        limit: this.parseEnvInt('THROTTLE_SEND_TX_LIMIT', 1),
        interval: this.parseEnvInt('THROTTLE_SEND_TX_INTERVAL', 1100)
      },
      searchAssets: {
        limit: this.parseEnvInt('THROTTLE_SEARCH_ASSETS_LIMIT', 5),
        interval: this.parseEnvInt('THROTTLE_SEARCH_ASSETS_INTERVAL', 1100)
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

  urlPath(relative: string): string {
    return join(this.basePath.pathname, relative);
  }

  get workerPrivateKeyBytes(): ReadonlyUint8Array {
    if (this._workerPrivateKeyBytes) {
      return this._workerPrivateKeyBytes;
    }

    // Try base58 format first
    if (!this.workerPrivateKey.startsWith('[')) {
      try {
        this._workerPrivateKeyBytes = getBase58Codec().encode(this.workerPrivateKey);
        if (this._workerPrivateKeyBytes.length !== 64) {
          throw new Error(`Invalid base58 key length: ${this._workerPrivateKeyBytes.length}, expected 64`);
        }
        return this._workerPrivateKeyBytes;
      } catch (err) {
        throw new Error(`Invalid WORKER_PRIVATE_KEY base58 format. Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Try JSON array format
    try {
      const secretKeyArray = JSON.parse(this.workerPrivateKey);
      if (!Array.isArray(secretKeyArray) || secretKeyArray.length !== 64) {
        throw new Error('Invalid array format or length');
      }
      this._workerPrivateKeyBytes = new Uint8Array(secretKeyArray);
      return this._workerPrivateKeyBytes;
    } catch (err) {
      throw new Error(`Invalid WORKER_PRIVATE_KEY format. Expected JSON array of 64 numbers from solana-keygen or base58 string. Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getSolanaRpcUrl(): string {
    return `https://${this.solanaNetwork}.helius-rpc.com/?api-key=${this.heliusApiKey}`;
  }
}
