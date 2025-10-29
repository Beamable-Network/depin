import {
    Address,
    Base58EncodedBytes,
    Codec,
    Endian,
    getAddressCodec,
    getAddressEncoder,
    getBase58Codec,
    getBooleanCodec,
    getProgramDerivedAddress,
    getStructCodec,
    getU16Codec,
    getU64Codec,
    ProgramDerivedAddress
} from "gill";
import { MONTHLY_POOL_SEED, WORKER_STAKE_PROGRAM } from "../../constants.js";
import { WorkerStakeAccountType } from "../../enums.js";
import { PoolMetricsWeighted, PoolMetricsWeightedCodec, POOL_METRICS_WEIGHTED_LEN } from "./types/index.js";

const addressEncoder = getAddressEncoder();

export class MonthlyPoolAccount {
    worker_collection: Address;
    month_period: number;
    base_revenue_percentage: number;
    addon_revenue_percentage: number;
    base_emission_percentage: number;
    initialized: boolean;
    base_pool: PoolMetricsWeighted;
    addon_pool: PoolMetricsWeighted;
    collected_bmb_base: bigint;

    constructor(fields: {
        worker_collection: Address;
        month_period: number;
        base_revenue_percentage: number;
        addon_revenue_percentage: number;
        base_emission_percentage: number;
        initialized: boolean;
        base_pool: PoolMetricsWeighted;
        addon_pool: PoolMetricsWeighted;
        collected_bmb_base: bigint;
    }) {
        this.worker_collection = fields.worker_collection;
        this.month_period = fields.month_period;
        this.base_revenue_percentage = fields.base_revenue_percentage;
        this.addon_revenue_percentage = fields.addon_revenue_percentage;
        this.base_emission_percentage = fields.base_emission_percentage;
        this.initialized = fields.initialized;
        this.base_pool = fields.base_pool;
        this.addon_pool = fields.addon_pool;
        this.collected_bmb_base = fields.collected_bmb_base;
    }

    public static calculateAccountSize(): bigint {
        return BigInt(
            1 + // discriminator
            32 + // worker_collection (address)
            2 + // month_period (u16)
            2 + // base_revenue_percentage (u16)
            2 + // addon_revenue_percentage (u16)
            2 + // base_emission_percentage (u16)
            1 + // initialized (bool)
            POOL_METRICS_WEIGHTED_LEN + // base_pool
            POOL_METRICS_WEIGHTED_LEN + // addon_pool
            8 // collected_bmb_base (u64)
        );
    }

    public static readonly DataCodecV1: Codec<MonthlyPoolAccount> = getStructCodec([
        ["worker_collection", getAddressCodec()],
        ["month_period", getU16Codec({ endian: Endian.Little })],
        ["base_revenue_percentage", getU16Codec({ endian: Endian.Little })],
        ["addon_revenue_percentage", getU16Codec({ endian: Endian.Little })],
        ["base_emission_percentage", getU16Codec({ endian: Endian.Little })],
        ["initialized", getBooleanCodec()],
        ["base_pool", PoolMetricsWeightedCodec],
        ["addon_pool", PoolMetricsWeightedCodec],
        ["collected_bmb_base", getU64Codec({ endian: Endian.Little })]
    ]);

    public static deserializeFrom(accountData: ArrayLike<number>): MonthlyPoolAccount;
    public static deserializeFrom(accountDataBase58: Base58EncodedBytes): MonthlyPoolAccount;
    public static deserializeFrom(accountData: ArrayLike<number> | Base58EncodedBytes): MonthlyPoolAccount {
        let accountDataBuffer: ArrayLike<number>;

        if (typeof accountData === 'string') {
            accountDataBuffer = getBase58Codec().encode(accountData);
        } else {
            accountDataBuffer = accountData;
        }

        const accountDiscriminator = accountDataBuffer[0];
        if (accountDiscriminator !== WorkerStakeAccountType.MonthlyPool) {
            throw new Error(`Invalid discriminator: ${accountDiscriminator}, expected ${WorkerStakeAccountType.MonthlyPool}`);
        }

        const data = Buffer.from(accountDataBuffer).subarray(1);
        const result = this.DataCodecV1.decode(data);
        return result;
    }

    public static async findMonthlyPoolPDA(workerCollection: Address, monthPeriod: number): Promise<ProgramDerivedAddress> {
        const monthPeriodBytes = new Uint8Array(2);
        new DataView(monthPeriodBytes.buffer).setUint16(0, monthPeriod, true); // little-endian

        const pda = await getProgramDerivedAddress({
            programAddress: WORKER_STAKE_PROGRAM,
            seeds: [MONTHLY_POOL_SEED, addressEncoder.encode(workerCollection), monthPeriodBytes]
        });
        return pda;
    }

    public static serialize(account: MonthlyPoolAccount): Uint8Array {
        const data = this.DataCodecV1.encode(account);
        const result = new Uint8Array(1 + data.length);
        result[0] = WorkerStakeAccountType.MonthlyPool;
        result.set(data, 1);
        return result;
    }
}
