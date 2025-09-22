import { Address, Base58EncodedBytes, Codec, getAddressCodec, getAddressEncoder, getBase58Codec, getOptionCodec, getProgramDerivedAddress, getStructCodec, getU64Codec, Option, ProgramDerivedAddress } from "gill";
import { CHECKER_SEED, DEPIN_PROGRAM, METADATA_SEED } from "../../constants.js";
import { DepinAccountType } from "../../enums.js";

const addressEncoder = getAddressEncoder();

export class CheckerMetadataAccount {
    suspendedAt: Option<bigint>;
    delegatedTo: Address;

    constructor(fields: {
        suspendedAt: Option<bigint>;
        delegatedTo: Address;
    }) {
        this.suspendedAt = fields.suspendedAt;
        this.delegatedTo = fields.delegatedTo;
    }

    public static LEN = 1 + 9 + 32;

    public static readonly DataCodecV1: Codec<CheckerMetadataAccount> = getStructCodec([
        ["suspendedAt", getOptionCodec(getU64Codec())],
        ["delegatedTo", getAddressCodec()]
    ]);

    public static deserializeFrom(accountData: ArrayLike<number>): CheckerMetadataAccount;
    public static deserializeFrom(accountDataBase58: Base58EncodedBytes): CheckerMetadataAccount;
    public static deserializeFrom(accountData: ArrayLike<number> | Base58EncodedBytes): CheckerMetadataAccount {
        let accountDataBuffer: ArrayLike<number>;

        if (typeof accountData === 'string') {
            accountDataBuffer = getBase58Codec().encode(accountData);
        } else {
            accountDataBuffer = accountData;
        }

        const accountDiscriminator = accountDataBuffer[0];
        if (accountDiscriminator !== DepinAccountType.CheckerMetadata) {
            throw new Error(`Invalid discriminator: ${accountDiscriminator}`);
        }

        const data = Buffer.from(accountDataBuffer).subarray(1); // Skip the first byte (discriminator)
        const result = this.DataCodecV1.decode(data);
        return result;
    }

    public static async findCheckerMetadataPDA(checkerLicense: Address, checker: Address): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: DEPIN_PROGRAM,
            seeds: [CHECKER_SEED, METADATA_SEED, addressEncoder.encode(checkerLicense), addressEncoder.encode(checker)]
        });
        return pda;
    }

    /**
     * Serialize a CheckerMetadataAccount payload into account bytes, including discriminator.
     */
    public static serialize(fields: {
        suspendedAt: Option<bigint>;
        delegatedTo: Address;
    }): Uint8Array {
        const inner = this.DataCodecV1.encode(fields);
        const out = new Uint8Array(1 + inner.length);
        out[0] = DepinAccountType.CheckerMetadata;
        out.set(inner, 1);
        return out;
    }
}
