import { Base58EncodedBytes, Codec, getProgramDerivedAddress, getStructCodec, getU32Codec, getBase58Codec, ProgramDerivedAddress } from "gill";
import { REV_SHARE_PROGRAM, REVSHARE_SEED, REVSHARE_STATE_SEED } from "./rev-share-constants.js";
import { RevShareAccountType } from "./rev-share-enums.js";

export class GlobalStateAccount {
    lastOfferId: number;

    constructor(fields: {
        lastOfferId: number;
    }) {
        this.lastOfferId = fields.lastOfferId;
    }

    public static calculateAccountSize(): number {
        return 1 + 4; // discriminator + lastOfferId (u32)
    }

    public static readonly DataCodecV1: Codec<GlobalStateAccount> = getStructCodec([
        ["lastOfferId", getU32Codec()],
    ]);

    public static serialize(account: GlobalStateAccount): Uint8Array {
        const data = this.DataCodecV1.encode(account);
        const result = new Uint8Array(1 + data.length);
        result[0] = RevShareAccountType.GlobalState;
        result.set(data, 1);
        return result;
    }

    public static deserializeFrom(accountData: ArrayLike<number>): GlobalStateAccount;
    public static deserializeFrom(accountDataBase58: Base58EncodedBytes): GlobalStateAccount;
    public static deserializeFrom(accountData: ArrayLike<number> | Base58EncodedBytes): GlobalStateAccount {
        let accountDataBuffer: ArrayLike<number>;

        if (typeof accountData === 'string') {
            accountDataBuffer = getBase58Codec().encode(accountData);
        } else {
            accountDataBuffer = accountData;
        }

        const accountDiscriminator = accountDataBuffer[0];
        if (accountDiscriminator !== RevShareAccountType.GlobalState) {
            throw new Error(`Invalid discriminator: ${accountDiscriminator}`);
        }

        const data = Buffer.from(accountDataBuffer).subarray(1);
        const result = this.DataCodecV1.decode(data);
        return result;
    }

    public static async findGlobalStatePDA(): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: REV_SHARE_PROGRAM,
            seeds: [REVSHARE_SEED, REVSHARE_STATE_SEED]
        });
        return pda;
    }
}
