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
import { USER_POSITION_SEED, WORKER_STAKE_PROGRAM } from "../../constants.js";
import { WorkerStakeAccountType } from "../../enums.js";
import { StakeEntry, StakeEntryCodec, STAKE_ENTRY_LEN } from "./types/index.js";

const addressEncoder = getAddressEncoder();

export class UserStakePositionAccount {
    user: Address;
    worker_collection: Address;
    staked_amount: bigint;
    stake_entries: StakeEntry[];
    opted_out_at_month_period: number;
    last_claimed_month_period: number;

    constructor(fields: {
        user: Address;
        worker_collection: Address;
        staked_amount: bigint;
        stake_entries: StakeEntry[];
        opted_out_at_month_period: number;
        last_claimed_month_period: number;
    }) {
        this.user = fields.user;
        this.worker_collection = fields.worker_collection;
        this.staked_amount = fields.staked_amount;
        this.stake_entries = fields.stake_entries;
        this.opted_out_at_month_period = fields.opted_out_at_month_period;
        this.last_claimed_month_period = fields.last_claimed_month_period;
    }

    public static calculateAccountSize(entryCount: number): bigint {
        return BigInt(
            1 + // discriminator
            32 + // user (address)
            32 + // worker_collection (address)
            8 + // staked_amount (u64)
            4 + (entryCount * STAKE_ENTRY_LEN) + // stake_entries (Vec<StakeEntry> with length prefix)
            2 + // opted_out_at_month_period (u16)
            2 // last_claimed_month_period (u16)
        );
    }

    public static readonly DataCodecV1: Codec<UserStakePositionAccount> = getStructCodec([
        ["user", getAddressCodec()],
        ["worker_collection", getAddressCodec()],
        ["staked_amount", getU64Codec({ endian: Endian.Little })],
        ["stake_entries", getArrayCodec(StakeEntryCodec)],
        ["opted_out_at_month_period", getU16Codec({ endian: Endian.Little })],
        ["last_claimed_month_period", getU16Codec({ endian: Endian.Little })]
    ]);

    public static deserializeFrom(accountData: ArrayLike<number>): UserStakePositionAccount;
    public static deserializeFrom(accountDataBase58: Base58EncodedBytes): UserStakePositionAccount;
    public static deserializeFrom(accountData: ArrayLike<number> | Base58EncodedBytes): UserStakePositionAccount {
        let accountDataBuffer: ArrayLike<number>;

        if (typeof accountData === 'string') {
            accountDataBuffer = getBase58Codec().encode(accountData);
        } else {
            accountDataBuffer = accountData;
        }

        const accountDiscriminator = accountDataBuffer[0];
        if (accountDiscriminator !== WorkerStakeAccountType.UserStakePosition) {
            throw new Error(`Invalid discriminator: ${accountDiscriminator}, expected ${WorkerStakeAccountType.UserStakePosition}`);
        }

        const data = Buffer.from(accountDataBuffer).subarray(1);
        const result = this.DataCodecV1.decode(data);
        return result;
    }

    public static async findUserStakePositionPDA(user: Address, workerCollection: Address): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: WORKER_STAKE_PROGRAM,
            seeds: [USER_POSITION_SEED, addressEncoder.encode(user), addressEncoder.encode(workerCollection)]
        });
        return pda;
    }

    public static serialize(account: UserStakePositionAccount): Uint8Array {
        const data = this.DataCodecV1.encode(account);
        const result = new Uint8Array(1 + data.length);
        result[0] = WorkerStakeAccountType.UserStakePosition;
        result.set(data, 1);
        return result;
    }
}
