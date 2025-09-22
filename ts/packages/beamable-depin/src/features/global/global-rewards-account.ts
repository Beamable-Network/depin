import { Base58EncodedBytes, Codec, Endian, getArrayCodec, getBase58Codec, getProgramDerivedAddress, getStructCodec, getU32Codec, ProgramDerivedAddress } from "gill";
import { DEPIN_PROGRAM, GLOBAL_REWARDS_SEED, GLOBAL_SEED } from "../../constants.js";
import { DepinAccountType } from "../../enums.js";

export class GlobalRewardsAccount {
    checkers: number[];

    constructor(checkers: number[] = new Array(100_000).fill(0)) {
        this.checkers = checkers;
    }

    public static readonly DataCodec: Codec<GlobalRewardsAccount> = getStructCodec([
        ["checkers", getArrayCodec(getU32Codec({ endian: Endian.Little }), { size: 100_000 })],
    ]);

    public static deserializeFrom(accountData: ArrayLike<number>): GlobalRewardsAccount;
    public static deserializeFrom(accountDataBase58: Base58EncodedBytes): GlobalRewardsAccount;
    public static deserializeFrom(accountData: ArrayLike<number> | Base58EncodedBytes): GlobalRewardsAccount {
        let accountDataBuffer: ArrayLike<number>;

        if (typeof accountData === 'string') {
            accountDataBuffer = getBase58Codec().encode(accountData);
        } else {
            accountDataBuffer = accountData;
        }

        const accountDiscriminator = accountDataBuffer[0];
        if (accountDiscriminator !== DepinAccountType.GlobalRewards) {
            throw new Error(`Invalid discriminator: ${accountDiscriminator}`);
        }

        const data = Buffer.from(accountDataBuffer).subarray(1); // Skip the first byte (discriminator)
        const result = this.DataCodec.decode(data);
        return new GlobalRewardsAccount(result.checkers);
    }

    public static serialize(account: GlobalRewardsAccount): Uint8Array {
        const data = GlobalRewardsAccount.DataCodec.encode(account);
        const result = new Uint8Array(data.length + 1);
        result[0] = DepinAccountType.GlobalRewards; // discriminator
        result.set(data, 1);
        return result;
    }

    public static readonly LEN: bigint = BigInt(400_001);

    public static async findGlobalRewardsPDA(): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: DEPIN_PROGRAM,
            seeds: [GLOBAL_SEED, GLOBAL_REWARDS_SEED]
        });
        return pda;
    }
}
