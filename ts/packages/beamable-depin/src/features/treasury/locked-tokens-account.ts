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
import { DEPIN_PROGRAM, LOCK_SEED, TREASURY_SEED } from "../../constants.js";
import { DepinAccountType } from "../../enums.js";
import { addressToBase58EncodedBytes, getDepinAccountFilter } from "../../utils/filters.js";

const addressEncoder = getAddressEncoder();

export class LockedTokensAccount {
    owner: Address;
    totalLocked: bigint;
    lockPeriod: number;
    unlockPeriod: number;

    constructor(fields: {
        owner: Address;
        totalLocked: bigint;
        lockPeriod: number;
        unlockPeriod: number;
    }) {
        this.owner = fields.owner;
        this.totalLocked = fields.totalLocked;
        this.lockPeriod = fields.lockPeriod;
        this.unlockPeriod = fields.unlockPeriod;
    }

    public static readonly DataCodecV1: Codec<LockedTokensAccount> = getStructCodec([
        ["owner", getAddressCodec()],
        ["totalLocked", getU64Codec()],
        ["lockPeriod", getU16Codec()],
        ["unlockPeriod", getU16Codec()],
    ]);

    public static deserializeFrom(accountData: ArrayLike<number>): LockedTokensAccount;
    public static deserializeFrom(accountDataBase58: Base58EncodedBytes): LockedTokensAccount;
    public static deserializeFrom(accountData: ArrayLike<number> | Base58EncodedBytes): LockedTokensAccount {
        let accountDataBuffer: ArrayLike<number>;

        if (typeof accountData === 'string') {
            accountDataBuffer = getBase58Codec().encode(accountData);
        } else {
            accountDataBuffer = accountData;
        }

        const accountDiscriminator = accountDataBuffer[0];
        if (accountDiscriminator !== DepinAccountType.LockedTokens) {
            throw new Error(`Invalid discriminator: ${accountDiscriminator}`);
        }

        const data = Buffer.from(accountDataBuffer).subarray(1);
        const result = this.DataCodecV1.decode(data);
        return result;
    }

    public static serialize(account: LockedTokensAccount): Uint8Array {
        const data = this.DataCodecV1.encode(account);
        const result = new Uint8Array(1 + data.length);
        result[0] = DepinAccountType.LockedTokens;
        result.set(data, 1);
        return result;
    }

    public static calculateAccountSize(): number {
        // discriminator + owner + totalLocked + lockPeriod + unlockPeriod
        return 1 + 32 + 8 + 2 + 2; // 45 bytes total
    }

    public static async findLockedTokensPDA(owner: Address, lockPeriod: number, unlockPeriod: number): Promise<ProgramDerivedAddress> {
        const lockBytes = new Uint8Array(2);
        new DataView(lockBytes.buffer).setUint16(0, lockPeriod, true);
        const unlockBytes = new Uint8Array(2);
        new DataView(unlockBytes.buffer).setUint16(0, unlockPeriod, true);

        const pda = await getProgramDerivedAddress({
            programAddress: DEPIN_PROGRAM,
            seeds: [TREASURY_SEED, LOCK_SEED, addressEncoder.encode(owner), lockBytes, unlockBytes]
        });
        return pda;
    }

    public static async getLockedTokens(
        getProgramAccounts: (programAddress: Address, filters: GetProgramAccountsMemcmpFilter[]) => Promise<Array<{ pubkey: string; account: { data: ArrayLike<number> | Base58EncodedBytes } }>>,
        owner: Address
    ): Promise<Array<{ address: Address; data: LockedTokensAccount }>> {
        const accounts = await getProgramAccounts(DEPIN_PROGRAM,
           [
                getDepinAccountFilter(DepinAccountType.LockedTokens),
                {
                    memcmp: {
                        offset: 1n, // discriminator
                        bytes: addressToBase58EncodedBytes(owner),
                        encoding: 'base58',
                    }
                },
            ]
        );

        const lockedAccounts: Array<{ address: Address; data: LockedTokensAccount }> = [];

        for (const account of accounts) {
            try {
                const lockedTokensData = (typeof account.account.data === 'string')
                    ? LockedTokensAccount.deserializeFrom(account.account.data as Base58EncodedBytes)
                    : LockedTokensAccount.deserializeFrom(account.account.data as ArrayLike<number>);

                lockedAccounts.push({
                    address: address(account.pubkey),
                    data: lockedTokensData,
                });
            } catch (err) {
                console.warn(`Failed to decode LockedTokens account ${account.pubkey}:`, err);
                continue;
            }
        }

        return lockedAccounts;
    }
}
