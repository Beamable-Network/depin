import { Address, Base58EncodedBytes, Codec, getAddressEncoder, getBase58Codec, getOptionCodec, getProgramDerivedAddress, getStructCodec, getU64Codec, Option, ProgramDerivedAddress } from "gill";
import { CHECKER_SEED, DEPIN_PROGRAM, LICENSE_SEED, METADATA_SEED } from "../../constants.js";
import { DepinAccountType } from "../../enums.js";

const addressEncoder = getAddressEncoder();

export class CheckerLicenseMetadataAccount {
    suspendedAt: Option<bigint>;

    constructor(fields: {
        suspendedAt: Option<bigint>;
    }) {
        this.suspendedAt = fields.suspendedAt;
    }

    public static LEN = 1 + 9;

    public static readonly DataCodecV1: Codec<CheckerLicenseMetadataAccount> = getStructCodec([
        ["suspendedAt", getOptionCodec(getU64Codec())],
    ]);

    public static deserializeFrom(accountData: ArrayLike<number>): CheckerLicenseMetadataAccount;
    public static deserializeFrom(accountDataBase58: Base58EncodedBytes): CheckerLicenseMetadataAccount;
    public static deserializeFrom(accountData: ArrayLike<number> | Base58EncodedBytes): CheckerLicenseMetadataAccount {
        let accountDataBuffer: ArrayLike<number>;

        if (typeof accountData === 'string') {
            accountDataBuffer = getBase58Codec().encode(accountData);
        } else {
            accountDataBuffer = accountData;
        }

        const accountDiscriminator = accountDataBuffer[0];
        if (accountDiscriminator !== DepinAccountType.CheckerLicenseMetadata) {
            throw new Error(`Invalid discriminator: ${accountDiscriminator}`);
        }

        const data = Buffer.from(accountDataBuffer).subarray(1); // Skip the first byte (discriminator)
        const result = this.DataCodecV1.decode(data);
        return result;
    }

    public static async findCheckerLicenseMetadataPDA(checkerLicense: Address): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: DEPIN_PROGRAM,
            seeds: [CHECKER_SEED, LICENSE_SEED, METADATA_SEED, addressEncoder.encode(checkerLicense)]
        });
        return pda;
    }
}
