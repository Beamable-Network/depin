import {
    Address,
    Base58EncodedBytes,
    Codec,
    Endian,
    getAddressCodec,
    getAddressEncoder,
    getArrayCodec,
    getBase58Codec,
    getProgramDerivedAddress,
    getStructCodec,
    getU16Codec,
    getU64Codec,
    ProgramDerivedAddress
} from "gill";
import { WORKER_STAKE_CONFIG_SEED, WORKER_STAKE_PROGRAM } from "../../constants.js";
import { WorkerStakeAccountType } from "../../enums.js";

const addressEncoder = getAddressEncoder();

export class WorkerStakeConfigAccount {
    worker_collection: Address;
    worker_wallet: Address;
    min_stake_requirement: bigint;
    total_staked: bigint;
    last_active_pool_month: number;
    active_pools: number[];

    constructor(fields: {
        worker_collection: Address;
        worker_wallet: Address;
        min_stake_requirement: bigint;
        total_staked: bigint;
        last_active_pool_month: number;
        active_pools: number[];
    }) {
        this.worker_collection = fields.worker_collection;
        this.worker_wallet = fields.worker_wallet;
        this.min_stake_requirement = fields.min_stake_requirement;
        this.total_staked = fields.total_staked;
        this.last_active_pool_month = fields.last_active_pool_month;
        this.active_pools = fields.active_pools;
    }

    public static calculateAccountSize(poolCount: number): bigint {
        return BigInt(
            1 + // discriminator
            32 + // worker_collection (address)
            32 + // worker_wallet (address)
            8 + // min_stake_requirement (u64)
            8 + // total_staked (u64)
            2 + // last_active_pool_month (u16)
            4 + (poolCount * 2) // active_pools (Vec<u16> with length prefix)
        );
    }

    public static readonly DataCodecV1: Codec<WorkerStakeConfigAccount> = getStructCodec([
        ["worker_collection", getAddressCodec()],
        ["worker_wallet", getAddressCodec()],
        ["min_stake_requirement", getU64Codec({ endian: Endian.Little })],
        ["total_staked", getU64Codec({ endian: Endian.Little })],
        ["last_active_pool_month", getU16Codec({ endian: Endian.Little })],
        ["active_pools", getArrayCodec(getU16Codec({ endian: Endian.Little }))]
    ]);

    public static deserializeFrom(accountData: ArrayLike<number>): WorkerStakeConfigAccount;
    public static deserializeFrom(accountDataBase58: Base58EncodedBytes): WorkerStakeConfigAccount;
    public static deserializeFrom(accountData: ArrayLike<number> | Base58EncodedBytes): WorkerStakeConfigAccount {
        let accountDataBuffer: ArrayLike<number>;

        if (typeof accountData === 'string') {
            accountDataBuffer = getBase58Codec().encode(accountData);
        } else {
            accountDataBuffer = accountData;
        }

        const accountDiscriminator = accountDataBuffer[0];
        if (accountDiscriminator !== WorkerStakeAccountType.WorkerStakeConfig) {
            throw new Error(`Invalid discriminator: ${accountDiscriminator}, expected ${WorkerStakeAccountType.WorkerStakeConfig}`);
        }

        const data = Buffer.from(accountDataBuffer).subarray(1);
        const result = this.DataCodecV1.decode(data);
        return result;
    }

    public static async findWorkerStakeConfigPDA(workerCollection: Address): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: WORKER_STAKE_PROGRAM,
            seeds: [WORKER_STAKE_CONFIG_SEED, addressEncoder.encode(workerCollection)]
        });
        return pda;
    }

    public static serialize(account: WorkerStakeConfigAccount): Uint8Array {
        const data = this.DataCodecV1.encode(account);
        const result = new Uint8Array(1 + data.length);
        result[0] = WorkerStakeAccountType.WorkerStakeConfig;
        result.set(data, 1);
        return result;
    }
}
