import { addCodecSizePrefix, Address, Base58EncodedBytes, Codec, getAddressCodec, getAddressEncoder, getBase58Codec, getOptionCodec, getProgramDerivedAddress, getStructCodec, getU32Codec, getU64Codec, getUtf8Codec, Option, ProgramDerivedAddress } from "gill";
import { DEPIN_PROGRAM, METADATA_SEED, WORKER_SEED } from "../../constants.js";
import { DepinAccountType } from "../../enums.js";

const addressEncoder = getAddressEncoder();

export class WorkerMetadataAccount {
    suspendedAt: Option<bigint>;
    delegatedTo: Address;
    license: Address;
    owner: Address;
    discoveryUri: string;

    constructor(fields: {
        suspendedAt: Option<bigint>;
        delegatedTo: Address;
        license: Address;
        discoveryUri: string;
    }) {
        this.suspendedAt = fields.suspendedAt;
        this.delegatedTo = fields.delegatedTo;
        this.license = fields.license;
        this.discoveryUri = fields.discoveryUri;
    }

    public static calculateAccountSize(discoveryUriLength: number): bigint {
        return BigInt(
            1 + // discriminator
            1 + 8 + // suspendedAt (Option<u64>)
            32 + // delegatedTo (address)
            32 + // license (address)
            32 + // owner (address)
            4 + discoveryUriLength // discoveryUri (String with length prefix)
        );
    }

    public static readonly DataCodecV1: Codec<WorkerMetadataAccount> = getStructCodec([
        ["suspendedAt", getOptionCodec(getU64Codec())],
        ["delegatedTo", getAddressCodec()],
        ["license", getAddressCodec()],
        ["owner", getAddressCodec()],
        ["discoveryUri", addCodecSizePrefix(getUtf8Codec(), getU32Codec())],
    ]);

    public static deserializeFrom(accountData: ArrayLike<number>): WorkerMetadataAccount;
    public static deserializeFrom(accountDataBase58: Base58EncodedBytes): WorkerMetadataAccount;
    public static deserializeFrom(accountData: ArrayLike<number> | Base58EncodedBytes): WorkerMetadataAccount {
        let accountDataBuffer: ArrayLike<number>;

        if (typeof accountData === 'string') {
            accountDataBuffer = getBase58Codec().encode(accountData);
        } else {
            accountDataBuffer = accountData;
        }

        const accountDiscriminator = accountDataBuffer[0];
        if (accountDiscriminator !== DepinAccountType.WorkerMetadata) {
            throw new Error(`Invalid discriminator: ${accountDiscriminator}`);
        }

        const data = Buffer.from(accountDataBuffer).subarray(1); // Skip the first byte (discriminator)
        const result = this.DataCodecV1.decode(data);
        return result;
    }

    public static async findWorkerMetadataPDA(workerLicense: Address, worker: Address): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: DEPIN_PROGRAM,
            seeds: [WORKER_SEED, METADATA_SEED, addressEncoder.encode(workerLicense), addressEncoder.encode(worker)]
        });
        return pda;
    }
}
