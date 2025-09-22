import { Address, Base58EncodedBytes, Codec, getBase58Codec, getProgramDerivedAddress, getStructCodec, ProgramDerivedAddress } from "gill";
import { LRUCache } from "lru-cache";
import { DEPIN_PROGRAM, GLOBAL_SEED, STATE_SEED } from "../../constants.js";
import { DepinAccountType } from "../../enums.js";
import { RingBuffer64, RingBuffer64Data } from "../../types/ring-buffer-64.js";

interface BMBStateAccountData {
    period_checkers_buffer: RingBuffer64Data;
}

export class BMBStateAccount implements BMBStateAccountData {
    period_checkers_buffer: RingBuffer64Data;

    public static readonly DataCodecV1: Codec<BMBStateAccountData> = getStructCodec([
        ["period_checkers_buffer", RingBuffer64.getDataCodec(16)],
    ]);

    constructor(fields: BMBStateAccountData) {
        this.period_checkers_buffer = fields.period_checkers_buffer;
    }

    public static deserializeFrom(accountData: ArrayLike<number>): BMBStateAccount;
    public static deserializeFrom(accountDataBase58: Base58EncodedBytes): BMBStateAccount;
    public static deserializeFrom(accountData: ArrayLike<number> | Base58EncodedBytes): BMBStateAccount {
        let accountDataBuffer: ArrayLike<number>;

        if (typeof accountData === 'string') {
            accountDataBuffer = getBase58Codec().encode(accountData);
        } else {
            accountDataBuffer = accountData;
        }

        const accountDiscriminator = accountDataBuffer[0];
        if (accountDiscriminator !== DepinAccountType.BMBState) {
            throw new Error(`Invalid discriminator: ${accountDiscriminator}`);
        }

        const data = Buffer.from(accountDataBuffer).subarray(1); // Skip the first byte (discriminator)
        const decoded = BMBStateAccount.DataCodecV1.decode(data);
        return new BMBStateAccount(decoded);
    }

    public static readonly LEN: bigint = BigInt(
        1 + // discriminator
        RingBuffer64.getLen(16)
    );

    public static async findPDA(): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: DEPIN_PROGRAM,
            seeds: [GLOBAL_SEED, STATE_SEED]
        });
        return pda;
    }

    private parsePeriodCheckerU64(value: bigint): { period: number, checkerCount: bigint } {
        const period = Number(value >> 48n); // Upper 16 bits (bits 48-63)
        const checkerCount = value & 0xFFFFFFFFFFFFn; // Lower 48 bits (bits 0-47)
        return { period, checkerCount };
    }

    public getCheckerCountForPeriod(targetPeriod: number): bigint | null {
        const ringBuffer = new RingBuffer64(this.period_checkers_buffer, 16);
        
        // Iterate backwards from current_index to find the first period <= target
        for (let i = 0; i < ringBuffer.capacity; i++) {
            const index = (ringBuffer.current_index - i + ringBuffer.capacity) % ringBuffer.capacity;
            const value = ringBuffer.buffer[index];
            
            if (value === 0n) continue;
            
            const parsed = this.parsePeriodCheckerU64(value);
            if (parsed.period <= targetPeriod) {
                return parsed.checkerCount;
            }
        }
        
        return null;
    }

    public static async readFromState(
        getAccountData: (address: Address) => ArrayLike<number> | Base58EncodedBytes | null | Promise<ArrayLike<number> | Base58EncodedBytes | null>
    ): Promise<{ address: Address; data: BMBStateAccount } | null> {
        const [addr] = await this.findPDA();
        const raw = await getAccountData(addr);
        if (!raw) return null;
        const decoded = (typeof raw === 'string')
            ? this.deserializeFrom(raw as Base58EncodedBytes)
            : this.deserializeFrom(raw as ArrayLike<number>);
        return { address: addr as Address, data: decoded };
    }

    // LRU Cache with TTL for storing BMBStateAccount data
    private static cache = new LRUCache<string, { address: Address; data: BMBStateAccount }>({
        max: 100, // max 100 entries
        ttl: 2 * 60 * 1000, // 2 minutes TTL
    });

    public static async readFromStateCached(
        getAccountData: (address: Address) => ArrayLike<number> | Base58EncodedBytes | null | Promise<ArrayLike<number> | Base58EncodedBytes | null>
    ): Promise<{ address: Address; data: BMBStateAccount } | null> {
        const [addr] = await this.findPDA();
        const cacheKey = addr;

        // Check cache first
        const cached = this.cache.get(cacheKey);
        if (cached) {
            return cached;
        }

        // Fetch fresh data
        const result = await this.readFromState(getAccountData);
        
        // Cache the result if it exists
        if (result) {
            this.cache.set(cacheKey, result);
        }

        return result;
    }
}