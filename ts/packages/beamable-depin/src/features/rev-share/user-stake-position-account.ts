import { Address, Base58EncodedBytes, Codec, getProgramDerivedAddress, getStructCodec, getU32Codec, getU64Codec, getI64Codec, getArrayCodec, getAddressCodec, getBase58Codec, ProgramDerivedAddress } from "gill";
import { REV_SHARE_PROGRAM, REVSHARE_SEED, USER_SEED } from "./rev-share-constants.js";
import { RevShareAccountType } from "./rev-share-enums.js";

export interface StakeEntry {
    amount: bigint;
    timestamp: bigint;
}

export const StakeEntryCodec: Codec<StakeEntry> = getStructCodec([
    ["amount", getU64Codec()],
    ["timestamp", getI64Codec()],
]);

export class UserStakePositionAccount {
    user: Address;
    stakedAmount: bigint;
    stakeEntries: StakeEntry[];
    optedOutAtOffer: number;
    lastClaimedOffer: number;

    constructor(fields: {
        user: Address;
        stakedAmount: bigint;
        stakeEntries: StakeEntry[];
        optedOutAtOffer: number;
        lastClaimedOffer: number;
    }) {
        this.user = fields.user;
        this.stakedAmount = fields.stakedAmount;
        this.stakeEntries = fields.stakeEntries;
        this.optedOutAtOffer = fields.optedOutAtOffer;
        this.lastClaimedOffer = fields.lastClaimedOffer;
    }

    public static calculateAccountSize(numStakeEntries: number): number {
        return 1 + 32 + 8 + 4 + (numStakeEntries * 16) + 4 + 4;
        // discriminator + pubkey + u64 + vec_len + entries + 2x u32
    }

    public static readonly DataCodecV1: Codec<UserStakePositionAccount> = getStructCodec([
        ["user", getAddressCodec()],
        ["stakedAmount", getU64Codec()],
        ["stakeEntries", getArrayCodec(StakeEntryCodec)],
        ["optedOutAtOffer", getU32Codec()],
        ["lastClaimedOffer", getU32Codec()],
    ]);

    public static serialize(account: UserStakePositionAccount): Uint8Array {
        const data = this.DataCodecV1.encode(account);
        const result = new Uint8Array(1 + data.length);
        result[0] = RevShareAccountType.UserStakePosition;
        result.set(data, 1);
        return result;
    }

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
        if (accountDiscriminator !== RevShareAccountType.UserStakePosition) {
            throw new Error(`Invalid discriminator: ${accountDiscriminator}`);
        }

        const data = Buffer.from(accountDataBuffer).subarray(1);
        const result = this.DataCodecV1.decode(data);
        return result;
    }

    public static async findUserStakePositionPDA(user: Address): Promise<ProgramDerivedAddress> {
        // Convert address from base58 string to bytes
        const userBytes = getBase58Codec().encode(user);
        const pda = await getProgramDerivedAddress({
            programAddress: REV_SHARE_PROGRAM,
            seeds: [REVSHARE_SEED, USER_SEED, userBytes]
        });
        return pda;
    }
}
