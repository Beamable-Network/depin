import { Base58EncodedBytes, Codec, getProgramDerivedAddress, getStructCodec, getU32Codec, getI64Codec, getU16Codec, getU64Codec, getArrayCodec, getBase58Codec, ProgramDerivedAddress } from "gill";
import { REV_SHARE_PROGRAM, OFFER_BOOK_SEED } from "./rev-share-constants.js";
import { RevShareAccountType } from "./rev-share-enums.js";

export class Offer {
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

    public static readonly Codec: Codec<Offer> = getStructCodec([
        ["offerId", getU32Codec()],
        ["startTime", getI64Codec()],
        ["endTime", getI64Codec()],
        ["revenuePercentage", getU16Codec()],
        ["totalStaked", getU64Codec()],
        ["totalStakedWeighted", getU64Codec()],
        ["totalStakedOptedOut", getU64Codec()],
        ["collectedUsdc", getU64Codec()],
    ]);
}

export class OfferBookAccount {
    offers: Offer[];

    constructor(fields: {
        offers: Offer[];
    }) {
        this.offers = fields.offers;
    }

    public static calculateAccountSize(numOffers: number): number {
        return 1 + 4 + (numOffers * 54); // discriminator + Vec length + offers (each offer is 54 bytes)
    }

    public static readonly DataCodecV1 = getStructCodec([
        ["offers", getArrayCodec(Offer.Codec)],
    ]);

    public static serialize(account: OfferBookAccount): Uint8Array {
        const data = this.DataCodecV1.encode(account);
        const result = new Uint8Array(1 + data.length);
        result[0] = RevShareAccountType.OfferBook;
        result.set(data, 1);
        return result;
    }

    public static deserializeFrom(accountData: ArrayLike<number>): OfferBookAccount;
    public static deserializeFrom(accountDataBase58: Base58EncodedBytes): OfferBookAccount;
    public static deserializeFrom(accountData: ArrayLike<number> | Base58EncodedBytes): OfferBookAccount {
        let accountDataBuffer: ArrayLike<number>;

        if (typeof accountData === 'string') {
            accountDataBuffer = getBase58Codec().encode(accountData);
        } else {
            accountDataBuffer = accountData;
        }

        const accountDiscriminator = accountDataBuffer[0];
        if (accountDiscriminator !== RevShareAccountType.OfferBook) {
            throw new Error(`Invalid discriminator: ${accountDiscriminator}`);
        }

        const data = Buffer.from(accountDataBuffer).subarray(1);
        const decoded = this.DataCodecV1.decode(data);
        return new OfferBookAccount({
            offers: decoded.offers.map((o: any) => new Offer(o))
        });
    }

    public static async findOfferBookPDA(): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: REV_SHARE_PROGRAM,
            seeds: [OFFER_BOOK_SEED]
        });
        return pda;
    }

    /**
     * Find the currently active offer based on the given timestamp
     */
    public getActiveOffer(currentTime: bigint): Offer | undefined {
        return this.offers.find(offer =>
            currentTime >= offer.startTime && currentTime <= offer.endTime
        );
    }

    /**
     * Find an offer by ID
     */
    public findOffer(offerId: number): Offer | undefined {
        return this.offers.find(offer => offer.offerId === offerId);
    }

    /**
     * Get the most recent offer (last in array)
     */
    public getLastOffer(): Offer | undefined {
        return this.offers[this.offers.length - 1];
    }
}
