import { Address, Base58EncodedBytes, Codec, ProgramDerivedAddress, getBase58Codec, getProgramDerivedAddress, getStructCodec, getU16Codec } from "gill";
import { CONFIG_SEED, DEPIN_PROGRAM, TREASURY_SEED } from "../../constants.js";
import { DepinAccountType } from "../../enums.js";

export class TreasuryConfigAccount {
    checkerRewardsLockDays: number;

    constructor(fields: { checkerRewardsLockDays: number }) {
        this.checkerRewardsLockDays = fields.checkerRewardsLockDays;
    }

    public static calculateAccountSize(): number {
        return 1 + 2; // discriminator + checkerRewardsLockDays (u16)
    }

    public static readonly DataCodecV1: Codec<TreasuryConfigAccount> = getStructCodec([
        ["checkerRewardsLockDays", getU16Codec()],
    ]);

    public static serialize(account: TreasuryConfigAccount): Uint8Array {
        const data = this.DataCodecV1.encode(account);
        const result = new Uint8Array(1 + data.length);
        result[0] = DepinAccountType.TreasuryConfig;
        result.set(data, 1);
        return result;
    }

    public static deserializeFrom(accountData: ArrayLike<number>): TreasuryConfigAccount;
    public static deserializeFrom(accountDataBase58: Base58EncodedBytes): TreasuryConfigAccount;
    public static deserializeFrom(accountData: ArrayLike<number> | Base58EncodedBytes): TreasuryConfigAccount {
        let accountDataBuffer: ArrayLike<number>;

        if (typeof accountData === 'string') {
            accountDataBuffer = getBase58Codec().encode(accountData);
        } else {
            accountDataBuffer = accountData;
        }

        const accountDiscriminator = accountDataBuffer[0];
        if (accountDiscriminator !== DepinAccountType.TreasuryConfig) {
            throw new Error(`Invalid discriminator: ${accountDiscriminator}`);
        }

        const data = Buffer.from(accountDataBuffer).subarray(1);
        const result = this.DataCodecV1.decode(data);
        return result;
    }

    public static async findTreasuryConfigPDA(): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: DEPIN_PROGRAM,
            seeds: [TREASURY_SEED, CONFIG_SEED]
        });
        return pda;
    }

    public static async readFromState(
        getAccountData: (address: Address) => ArrayLike<number> | Base58EncodedBytes | null
    ): Promise<{ address: Address; data: TreasuryConfigAccount } | null> {
        const [addr] = await this.findTreasuryConfigPDA();
        const raw = getAccountData(addr);
        if (!raw) return null;
        const decoded = (typeof raw === 'string')
            ? this.deserializeFrom(raw as Base58EncodedBytes)
            : this.deserializeFrom(raw as ArrayLike<number>);
        return { address: addr as Address, data: decoded };
    }
}
