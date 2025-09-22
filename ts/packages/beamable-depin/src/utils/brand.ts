import { Address } from "gill";
import jssha3 from "js-sha3";
import bs58 from "bs58";
const { keccak256 } = jssha3;

const U64_MASK = 0xFFFF_FFFF_FFFF_FFFFn;
const BRAND_COUNT = 512;

function splitmix64(seed: bigint): bigint {
  let z = (seed + 0x9E3779B97F4A7C15n) & U64_MASK;
  z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & U64_MASK;
  z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & U64_MASK;
  return z ^ (z >> 31n);
}

function toBytes(input: Uint8Array | Buffer | number[] | Address): Buffer {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (typeof input === 'string') return Buffer.from(bs58.decode(input));
  return Buffer.from(input);
}

function createSeed(pubkey: Uint8Array | Buffer | number[] | Address, epoch: number | bigint): bigint {
  const pk = toBytes(pubkey);

  const epochNum = Number(epoch);
  const epochBuf = Buffer.alloc(2);
  epochBuf.writeUInt16BE(epochNum);

  const data = Buffer.concat([pk, epochBuf]);
  const hash = keccak256(data);

  // Convert hex string to Buffer and take the first 8 bytes as big-endian u64
  const hashBuffer = Buffer.from(hash, 'hex');
  const first8 = hashBuffer.subarray(0, 8);
  return first8.readBigUInt64BE(0);
}

export function runBrand(
  pubkey: Uint8Array | Buffer | number[] | Address,
  epoch: number | bigint,
  max_val: number | bigint
): number[] {
  const maxBig = BigInt(max_val);
  const result = new Set<number>();
  let current_seed = createSeed(pubkey, epoch);

  while (result.size < BRAND_COUNT) {
    current_seed = splitmix64(current_seed);
    const v = current_seed % maxBig;

    result.add(Number(v));
  }

  return Array.from(result);
}

export function isCheckerAssigned(workerLicense: Address, checkerLicenseIndex: number, period: number, checkerCount: number): boolean {
  const brandOutput = runBrand(workerLicense, period, checkerCount);
  const checkerIndex = brandOutput.indexOf(checkerLicenseIndex);
  return checkerIndex !== -1;
}