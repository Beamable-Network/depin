import dotenv from 'dotenv';
import { dirname, join } from 'path';

const workerDir = dirname(import.meta.dirname);
const envPath = join(workerDir, '.env');
dotenv.config({ path: envPath });

export class WorkerConfig {
  public readonly port: number;
  public readonly host: string;
  public readonly solanaRpcUrl: string;
  public readonly workerPrivateKey: string;
  public readonly workerLicense: string;
  public readonly externalUrl: string;
  public readonly environment: 'development' | 'production' | 'testing';
  public readonly s3Config: {
    bucketName: string;
    region: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  private _workerPrivateKeyBytes?: Uint8Array;

  constructor() {
    const externalUrl = process.env.EXTERNAL_URL;
    const workerPrivateKey = process.env.WORKER_PRIVATE_KEY;
    const workerLicense = process.env.WORKER_LICENSE;
    const s3BucketName = process.env.S3_BUCKET_NAME;
    const s3Region = process.env.S3_REGION;

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

    this.port = parseInt(process.env.PORT || '3000');
    this.host = process.env.HOST || '0.0.0.0';
    this.solanaRpcUrl = process.env.SOLANA_RPC_URL || 'http://localhost:8899';
    this.workerPrivateKey = workerPrivateKey;
    this.workerLicense = workerLicense;
    this.environment = (process.env.NODE_ENV as WorkerConfig['environment']) || 'development';
    this.externalUrl = externalUrl;
    this.s3Config = {
      bucketName: s3BucketName,
      region: s3Region,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
    };
  }

  get workerPrivateKeyBytes(): Uint8Array {
    if (this._workerPrivateKeyBytes) {
      return this._workerPrivateKeyBytes;
    }

    try {
      const secretKeyArray = JSON.parse(this.workerPrivateKey);
      if (!Array.isArray(secretKeyArray) || secretKeyArray.length !== 64) {
        throw new Error('Invalid array format or length');
      }
      this._workerPrivateKeyBytes = new Uint8Array(secretKeyArray);
      return this._workerPrivateKeyBytes;
    } catch (err) {
      throw new Error(`Invalid WORKER_PRIVATE_KEY format. Expected JSON array of 64 numbers from solana-keygen grind. Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
