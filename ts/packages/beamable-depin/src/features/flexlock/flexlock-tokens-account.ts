import {
    Address,
    address,
    Base58EncodedBytes,
    Codec,
    getAddressCodec,
    getAddressEncoder,
    getBase58Codec,
    GetProgramAccountsMemcmpFilter,
    getProgramDerivedAddress,
    getStructCodec,
    getU16Codec,
    getU64Codec,
    ProgramDerivedAddress
} from "gill";
import { DEPIN_PROGRAM, FLEXLOCK_SEED, LOCK_SEED } from "../../constants.js";
import { DepinAccountType } from "../../enums.js";
import { addressToBase58EncodedBytes, getDepinAccountFilter } from "../../utils/filters.js";

const addressEncoder = getAddressEncoder();

export class FlexlockTokensAccount {
    sender: Address;
    receiver: Address;
    amount: bigint;
    lockPeriod: number;
    unlockPeriod: number;

    constructor(fields: {
        sender: Address;
        receiver: Address;
        amount: bigint;
        lockPeriod: number;
        unlockPeriod: number;
    }) {
        this.sender = fields.sender;
        this.receiver = fields.receiver;
        this.amount = fields.amount;
        this.lockPeriod = fields.lockPeriod;
        this.unlockPeriod = fields.unlockPeriod;
    }

    public static readonly DataCodecV1: Codec<FlexlockTokensAccount> = getStructCodec([
        ["sender", getAddressCodec()],
        ["receiver", getAddressCodec()],
        ["amount", getU64Codec()],
        ["lockPeriod", getU16Codec()],
        ["unlockPeriod", getU16Codec()],
    ]);

    public static deserializeFrom(accountData: ArrayLike<number>): FlexlockTokensAccount;
    public static deserializeFrom(accountDataBase58: Base58EncodedBytes): FlexlockTokensAccount;
    public static deserializeFrom(accountData: ArrayLike<number> | Base58EncodedBytes): FlexlockTokensAccount {
        let accountDataBuffer: ArrayLike<number>;

        if (typeof accountData === 'string') {
            accountDataBuffer = getBase58Codec().encode(accountData);
        } else {
            accountDataBuffer = accountData;
        }

        const accountDiscriminator = accountDataBuffer[0];
        if (accountDiscriminator !== DepinAccountType.FlexlockTokens) {
            throw new Error(`Invalid discriminator: ${accountDiscriminator}`);
        }

        const data = Buffer.from(accountDataBuffer).subarray(1);
        const result = this.DataCodecV1.decode(data);
        return result;
    }

    public static serialize(account: FlexlockTokensAccount): Uint8Array {
        const data = this.DataCodecV1.encode(account);
        const result = new Uint8Array(1 + data.length);
        result[0] = DepinAccountType.FlexlockTokens;
        result.set(data, 1);
        return result;
    }

    public static calculateAccountSize(): number {
        // discriminator + sender + receiver + amount + lockPeriod + unlockPeriod
        return 1 + 32 + 32 + 8 + 2 + 2; // 77 bytes total
    }

    public static async findFlexlockTokensPDA(
        sender: Address,
        receiver: Address,
        lockPeriod: number,
        unlockPeriod: number
    ): Promise<ProgramDerivedAddress> {
        const lockBytes = new Uint8Array(2);
        new DataView(lockBytes.buffer).setUint16(0, lockPeriod, true);
        const unlockBytes = new Uint8Array(2);
        new DataView(unlockBytes.buffer).setUint16(0, unlockPeriod, true);

        const pda = await getProgramDerivedAddress({
            programAddress: DEPIN_PROGRAM,
            seeds: [
                FLEXLOCK_SEED,
                LOCK_SEED,
                addressEncoder.encode(sender),
                addressEncoder.encode(receiver),
                lockBytes,
                unlockBytes
            ]
        });
        return pda;
    }

    public static async getFlexlockTokensBySender(
        getProgramAccounts: (programAddress: Address, filters: GetProgramAccountsMemcmpFilter[]) => Promise<Array<{ pubkey: string; account: { data: ArrayLike<number> | Base58EncodedBytes } }>>,
        sender: Address
    ): Promise<Array<{ address: Address; data: FlexlockTokensAccount }>> {
        const accounts = await getProgramAccounts(DEPIN_PROGRAM,
            [
                getDepinAccountFilter(DepinAccountType.FlexlockTokens),
                {
                    memcmp: {
                        offset: 1n, // discriminator
                        bytes: addressToBase58EncodedBytes(sender),
                        encoding: 'base58',
                    }
                },
            ]
        );

        return this.parseFlexlockAccounts(accounts);
    }

    public static async getFlexlockTokensByReceiver(
        getProgramAccounts: (programAddress: Address, filters: GetProgramAccountsMemcmpFilter[]) => Promise<Array<{ pubkey: string; account: { data: ArrayLike<number> | Base58EncodedBytes } }>>,
        receiver: Address
    ): Promise<Array<{ address: Address; data: FlexlockTokensAccount }>> {
        const accounts = await getProgramAccounts(DEPIN_PROGRAM,
            [
                getDepinAccountFilter(DepinAccountType.FlexlockTokens),
                {
                    memcmp: {
                        offset: 33n, // discriminator + sender (32 bytes)
                        bytes: addressToBase58EncodedBytes(receiver),
                        encoding: 'base58',
                    }
                },
            ]
        );

        return this.parseFlexlockAccounts(accounts);
    }

    private static parseFlexlockAccounts(
        accounts: Array<{ pubkey: string; account: { data: ArrayLike<number> | Base58EncodedBytes } }>
    ): Array<{ address: Address; data: FlexlockTokensAccount }> {
        const flexlockAccounts: Array<{ address: Address; data: FlexlockTokensAccount }> = [];

        for (const account of accounts) {
            try {
                const flexlockTokensData = (typeof account.account.data === 'string')
                    ? FlexlockTokensAccount.deserializeFrom(account.account.data as Base58EncodedBytes)
                    : FlexlockTokensAccount.deserializeFrom(account.account.data as ArrayLike<number>);

                flexlockAccounts.push({
                    address: address(account.pubkey),
                    data: flexlockTokensData,
                });
            } catch (err) {
                console.warn(`Failed to decode FlexlockTokens account ${account.pubkey}:`, err);
                continue;
            }
        }

        return flexlockAccounts;
    }
}
