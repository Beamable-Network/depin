import { Base58EncodedBytes, Codec, getProgramDerivedAddress, getStructCodec, getU32Codec, getI64Codec, getU16Codec, getU64Codec, getBase58Codec, ProgramDerivedAddress } from "gill";
import { REV_SHARE_PROGRAM, REVSHARE_SEED, OFFER_SEED } from "./rev-share-constants.js";
import { RevShareAccountType } from "./rev-share-enums.js";

export class RevShareOfferAccount {
    offerId: number;
    startTime: bigint;
    endTime: bigint;
    revenuePercentage: number;
    totalStaked: bigint;
    totalStakedWeighted: bigint;
    totalStakedOptedOut: bigint;
    collectedUsdc: bigint;

    constructor(fields: {
        offerId: number;
        startTime: bigint;
        endTime: bigint;
        revenuePercentage: number;
        totalStaked: bigint;
        totalStakedWeighted: bigint;
        totalStakedOptedOut: bigint;
        collectedUsdc: bigint;
    }) {
        this.offerId = fields.offerId;
        this.startTime = fields.startTime;
        this.endTime = fields.endTime;
        this.revenuePercentage = fields.revenuePercentage;
        this.totalStaked = fields.totalStaked;
        this.totalStakedWeighted = fields.totalStakedWeighted;
        this.totalStakedOptedOut = fields.totalStakedOptedOut;
        this.collectedUsdc = fields.collectedUsdc;
    }

    public static calculateAccountSize(): number {
        return 1 + 4 + 8 + 8 + 2 + 8 + 8 + 8 + 8; // discriminator + all fields
    }

    public static readonly DataCodecV1: Codec<RevShareOfferAccount> = getStructCodec([
        ["offerId", getU32Codec()],
        ["startTime", getI64Codec()],
        ["endTime", getI64Codec()],
        ["revenuePercentage", getU16Codec()],
        ["totalStaked", getU64Codec()],
        ["totalStakedWeighted", getU64Codec()],
        ["totalStakedOptedOut", getU64Codec()],
        ["collectedUsdc", getU64Codec()],
    ]);

    public static serialize(account: RevShareOfferAccount): Uint8Array {
        const data = this.DataCodecV1.encode(account);
        const result = new Uint8Array(1 + data.length);
        result[0] = RevShareAccountType.RevShareOffer;
        result.set(data, 1);
        return result;
    }

    public static deserializeFrom(accountData: ArrayLike<number>): RevShareOfferAccount;
    public static deserializeFrom(accountDataBase58: Base58EncodedBytes): RevShareOfferAccount;
    public static deserializeFrom(accountData: ArrayLike<number> | Base58EncodedBytes): RevShareOfferAccount {
        let accountDataBuffer: ArrayLike<number>;

        if (typeof accountData === 'string') {
            accountDataBuffer = getBase58Codec().encode(accountData);
        } else {
            accountDataBuffer = accountData;
        }

        const accountDiscriminator = accountDataBuffer[0];
        if (accountDiscriminator !== RevShareAccountType.RevShareOffer) {
            throw new Error(`Invalid discriminator: ${accountDiscriminator}`);
        }

        const data = Buffer.from(accountDataBuffer).subarray(1);
        const result = this.DataCodecV1.decode(data);
        return result;
    }

    public static async findOfferPDA(offerId: number): Promise<ProgramDerivedAddress> {
        const offerIdBytes = new Uint8Array(4);
        new DataView(offerIdBytes.buffer).setUint32(0, offerId, true);

        const pda = await getProgramDerivedAddress({
            programAddress: REV_SHARE_PROGRAM,
            seeds: [REVSHARE_SEED, OFFER_SEED, offerIdBytes]
        });
        return pda;
    }
}
