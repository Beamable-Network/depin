import dotenv from 'dotenv';
import { dirname, join } from 'path';

const checkerDir = dirname(import.meta.dirname);
const envPath = join(checkerDir, '.env');
dotenv.config({ path: envPath });

export class CheckerConfig {  
  public readonly solanaNetwork: "mainnet" | "devnet";
  public readonly heliusApiKey: string;
  public readonly checkerPrivateKey: string;
  public readonly checkerLicense: string;
  public readonly skipBrand: boolean;

  private _checkerPrivateKeyBytes?: Uint8Array;

  constructor() {
    const solanaNetwork = process.env.SOLANA_NETWORK;
    const heliusApiKey = process.env.HELIUS_API_KEY;
    const checkerPrivateKey = process.env.CHECKER_PRIVATE_KEY;
    const checkerLicense = process.env.CHECKER_LICENSE;
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

    if (!checkerLicense) {
      throw new Error('CHECKER_LICENSE environment variable is required');
    }

    this.solanaNetwork = solanaNetwork;
    this.checkerPrivateKey = checkerPrivateKey;
    this.checkerLicense = checkerLicense;
    this.heliusApiKey = heliusApiKey;
    this.skipBrand = skipBrand === 'true' || skipBrand === '1';
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
