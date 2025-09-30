import { address, Address, Base58EncodedBytes, Codec, getAddressCodec, getAddressEncoder, getBase58Codec, getOptionCodec, GetProgramAccountsMemcmpFilter, getProgramDerivedAddress, getStructCodec, getU32Codec, getU64Codec, Option, ProgramDerivedAddress } from "gill";
import { CHECKER_SEED, DEPIN_PROGRAM, METADATA_SEED } from "../../constants.js";
import { DepinAccountType } from "../../enums.js";
import { addressToBase58EncodedBytes, getDepinAccountFilter, optionNoneToBase58EncodedBytes } from "../../index.js";

const addressEncoder = getAddressEncoder();

export class CheckerMetadataAccount {
    suspendedAt: Option<bigint>;
    delegatedTo: Address;
    licenseIndex: number;

    constructor(fields: {
        suspendedAt: Option<bigint>;
        delegatedTo: Address;
        licenseIndex: number;
    }) {
        this.suspendedAt = fields.suspendedAt;
        this.delegatedTo = fields.delegatedTo;
        this.licenseIndex = fields.licenseIndex;
    }

    public static LEN = 1 + 9 + 32 + 32;

    public static readonly DataCodecV1: Codec<CheckerMetadataAccount> = getStructCodec([
        ["suspendedAt", getOptionCodec(getU64Codec())],
        ["delegatedTo", getAddressCodec()],
        ["licenseIndex", getU32Codec()],
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
        licenseIndex: number;
    }): Uint8Array {
        const inner = this.DataCodecV1.encode(fields);
        const out = new Uint8Array(1 + inner.length);
        out[0] = DepinAccountType.CheckerMetadata;
        out.set(inner, 1);
        return out;
    }

    public static async getActiveAccountsByDelegate(
        getProgramAccounts: (programAddress: Address, filters: GetProgramAccountsMemcmpFilter[]) => Promise<Array<{ pubkey: string; account: { data: ArrayLike<number> | Base58EncodedBytes } }>>,
        delegate: Address
    ): Promise<Array<{ address: Address; data: CheckerMetadataAccount }>> {
        const accounts = await getProgramAccounts(DEPIN_PROGRAM,
            [
                getDepinAccountFilter(DepinAccountType.CheckerMetadata),
                {
                    memcmp: {
                        offset: 1n, // discriminator
                        bytes: optionNoneToBase58EncodedBytes(),
                        encoding: 'base58',
                    }
                },
                {
                    memcmp: {
                        offset: BigInt(1 + 9), // discriminator + suspendedAt
                        bytes: addressToBase58EncodedBytes(delegate),
                        encoding: 'base58',
                    }
                }
            ]
        );

        const parsedAccounts: Array<{ address: Address; data: CheckerMetadataAccount }> = [];

        for (const account of accounts) {
            try {
                const accountData = (typeof account.account.data === 'string')
                    ? CheckerMetadataAccount.deserializeFrom(account.account.data as Base58EncodedBytes)
                    : CheckerMetadataAccount.deserializeFrom(account.account.data as ArrayLike<number>);

                parsedAccounts.push({
                    address: address(account.pubkey),
                    data: accountData,
                });
            } catch (err) {
                console.warn(`Failed to decode CheckerMetadata account ${account.pubkey}:`, err);
                continue;
            }
        }

        return parsedAccounts;
    }
}
