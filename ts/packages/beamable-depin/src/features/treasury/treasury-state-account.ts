import { Base58EncodedBytes, Codec, getProgramDerivedAddress, getStructCodec, getU64Codec, getBase58Codec, ProgramDerivedAddress } from "gill";
import { DEPIN_PROGRAM, TREASURY_SEED, STATE_SEED } from "../../constants.js";
import { DepinAccountType } from "../../enums.js";

export class TreasuryStateAccount {
    lockedBalance: bigint;

    constructor(fields: { 
        lockedBalance: bigint; 
    }) {
        this.lockedBalance = fields.lockedBalance;
    }

    public static calculateAccountSize(): number {
        return 1 + 8; // discriminator + lockedBalance (u64)
    }

    public static readonly DataCodecV1: Codec<TreasuryStateAccount> = getStructCodec([
        ["lockedBalance", getU64Codec()],
    ]);

    public static serialize(account: TreasuryStateAccount): Uint8Array {
        const data = this.DataCodecV1.encode(account);
        const result = new Uint8Array(1 + data.length);
        result[0] = DepinAccountType.TreasuryState;
        result.set(data, 1);
        return result;
    }

    public static deserializeFrom(accountData: ArrayLike<number>): TreasuryStateAccount;
    public static deserializeFrom(accountDataBase58: Base58EncodedBytes): TreasuryStateAccount;
    public static deserializeFrom(accountData: ArrayLike<number> | Base58EncodedBytes): TreasuryStateAccount {
        let accountDataBuffer: ArrayLike<number>;

        if (typeof accountData === 'string') {
            accountDataBuffer = getBase58Codec().encode(accountData);
        } else {
            accountDataBuffer = accountData;
        }

        const accountDiscriminator = accountDataBuffer[0];
        if (accountDiscriminator !== DepinAccountType.TreasuryState) {
            throw new Error(`Invalid discriminator: ${accountDiscriminator}`);
        }

        const data = Buffer.from(accountDataBuffer).subarray(1); // Skip the first byte (discriminator)
        const result = this.DataCodecV1.decode(data);
        return result;
    }

    public static async findTreasuryStatePDA(): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: DEPIN_PROGRAM,
            seeds: [TREASURY_SEED, STATE_SEED]
        });
        return pda;
    }
}