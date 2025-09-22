import { Address, Base58EncodedBytes, Codec, getAddressEncoder, getBase58Codec, getOptionCodec, getProgramDerivedAddress, getStructCodec, getU64Codec, getU8Codec, Option, ProgramDerivedAddress } from "gill";
import { DEPIN_PROGRAM, WORKER_SEED, LICENSE_SEED } from "../../constants.js";
import { DepinAccountType } from "../../enums.js";

export class WorkerLicenseMetadataAccount {
    suspendedAt: Option<bigint>;

    constructor(fields: { 
        suspendedAt: Option<bigint>; 
    }) {
        this.suspendedAt = fields.suspendedAt;
    }

    public static calculateAccountSize(): bigint {
        return BigInt(
            1 + // discriminator
            1 + 8 // suspendedAt (Option<u64>)
        );
    }

    public static readonly DataCodecV1: Codec<WorkerLicenseMetadataAccount> = getStructCodec([
        ["suspendedAt", getOptionCodec(getU64Codec())],
    ]);

    public static deserializeFrom(accountData: ArrayLike<number>): WorkerLicenseMetadataAccount;
    public static deserializeFrom(accountDataBase58: Base58EncodedBytes): WorkerLicenseMetadataAccount;
    public static deserializeFrom(accountData: ArrayLike<number> | Base58EncodedBytes): WorkerLicenseMetadataAccount {
        let accountDataBuffer: ArrayLike<number>;

        if (typeof accountData === 'string') {
            accountDataBuffer = getBase58Codec().encode(accountData);
        } else {
            accountDataBuffer = accountData;
        }

        const accountDiscriminator = accountDataBuffer[0];
        if (accountDiscriminator !== DepinAccountType.WorkerLicenseMetadata) {
            throw new Error(`Invalid discriminator: ${accountDiscriminator}`);
        }

        const data = Buffer.from(accountDataBuffer).subarray(1); // Skip the first byte (discriminator)
        const result = this.DataCodecV1.decode(data);
        return result;
    }
}

const addressEncoder = getAddressEncoder();

export async function findWorkerLicenseMetadataPDA(workerLicense: Address): Promise<ProgramDerivedAddress> {
    const pda = await getProgramDerivedAddress({
        programAddress: DEPIN_PROGRAM,
        seeds: [WORKER_SEED, LICENSE_SEED, addressEncoder.encode(workerLicense)]
    });
    return pda;
}