import dotenv from 'dotenv';
import { dirname, join } from 'path';

const checkerDir = dirname(import.meta.dirname);
const envPath = join(checkerDir, '.env');
dotenv.config({ path: envPath });

export class CheckerConfig {
  public readonly solanaRpcUrl: string;
  public readonly checkerPrivateKey: string;
  public readonly checkerLicense: string;
  public readonly environment: 'development' | 'production' | 'testing';

  private _checkerPrivateKeyBytes?: Uint8Array;

  constructor() {
    const solanaRpcUrl = process.env.SOLANA_RPC_URL;
    const checkerPrivateKey = process.env.CHECKER_PRIVATE_KEY;
    const checkerLicense = process.env.CHECKER_LICENSE;

    if (!solanaRpcUrl) {
      throw new Error('SOLANA_RPC_URL environment variable is required');
    }

    if (!checkerPrivateKey) {
      throw new Error('CHECKER_PRIVATE_KEY environment variable is required');
    }

    if (!checkerLicense) {
      throw new Error('CHECKER_LICENSE environment variable is required');
    }

    this.solanaRpcUrl = solanaRpcUrl;
    this.checkerPrivateKey = checkerPrivateKey;
    this.checkerLicense = checkerLicense;
    this.environment = (process.env.NODE_ENV as CheckerConfig['environment']) || 'development';
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
}
