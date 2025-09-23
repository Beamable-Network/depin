import {
    Address,
    address,
    Base58EncodedBytes,
    Codec,
    getAddressCodec,
    getAddressEncoder,
    getBase58Codec,
    getI64Codec,
    getOptionCodec,
    getProgramDerivedAddress,
    getStructCodec,
    getU16Codec,
    getU64Codec,
    Option,
    ProgramDerivedAddress,
    Rpc,
    SolanaRpcApi
} from "gill";
import { DEPIN_PROGRAM, LOCK_SEED, TREASURY_SEED } from "../../constants.js";
import { DepinAccountType } from "../../enums.js";
import { addressToBase58EncodedBytes, getDepinAccountFilter, optionNoneToBase58EncodedBytes } from "../../utils/filters.js";

const addressEncoder = getAddressEncoder();

export class LockedTokensAccount {
    owner: Address;
    totalLocked: bigint;
    lockPeriod: number;
    unlockPeriod: number;
    unlockedAt: Option<bigint>;

    constructor(fields: {
        owner: Address;
        totalLocked: bigint;
        lockPeriod: number;
        unlockPeriod: number;
        unlockedAt: Option<bigint>;
    }) {
        this.owner = fields.owner;
        this.totalLocked = fields.totalLocked;
        this.lockPeriod = fields.lockPeriod;
        this.unlockPeriod = fields.unlockPeriod;
        this.unlockedAt = fields.unlockedAt;
    }

    public static readonly DataCodecV1: Codec<LockedTokensAccount> = getStructCodec([
        ["owner", getAddressCodec()],
        ["totalLocked", getU64Codec()],
        ["lockPeriod", getU16Codec()],
        ["unlockPeriod", getU16Codec()],
        ["unlockedAt", getOptionCodec(getI64Codec())],
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
        // discriminator + owner + totalLocked + lockPeriod + unlockPeriod + Option<i64>
        return 1 + 32 + 8 + 2 + 2 + 1 + 8; // 54 bytes total
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
        rpc: Rpc<SolanaRpcApi>,
        owner: Address
    ): Promise<Array<{ address: Address; data: LockedTokensAccount }>> {
        const accounts = await rpc.getProgramAccounts(DEPIN_PROGRAM, {
            filters: [
                getDepinAccountFilter(DepinAccountType.LockedTokens),
                {
                    memcmp: {
                        offset: 1n, // discriminator
                        bytes: addressToBase58EncodedBytes(owner),
                        encoding: 'base58',
                    }
                },
                {
                    memcmp: {
                        offset: BigInt(1 + 32 + 8 + 2 + 2), // discriminator + owner + totalLocked + lockPeriod + unlockPeriod
                        bytes: optionNoneToBase58EncodedBytes(), // Option<i64> None is single 0 byte
                        encoding: 'base58',
                    }
                }
            ]
        }).send();

        const lockedAccounts: Array<{ address: Address; data: LockedTokensAccount }> = [];

        for (const account of accounts) {
            try {
                const lockedTokensData = LockedTokensAccount.deserializeFrom(account.account.data);

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
