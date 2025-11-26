import { Address, Base58EncodedBytes, Codec, getBase58Codec, getProgramDerivedAddress, getStructCodec, getU16Codec, ProgramDerivedAddress } from "gill";
import { CHECKER_SEED, DEPIN_PROGRAM, GLOBAL_REWARDS_SEED, VAULT_SEED } from "../../constants.js";
import { DepinAccountType } from "../../enums.js";

export class CheckerRewardsVault {
    // Checker rewards vault PDA
    public static async findPDA(): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: DEPIN_PROGRAM,
            seeds: [VAULT_SEED, GLOBAL_REWARDS_SEED, CHECKER_SEED]
        });
        return pda;
    }

        lockDays: number;

    constructor(fields: { lockDays: number }) {
        this.lockDays = fields.lockDays;
    }

    public static calculateAccountSize(): number {
        return 1 + 2; // discriminator + lockDays (u16)
    }

    public static readonly DataCodecV1: Codec<CheckerRewardsVault> = getStructCodec([
        ["lockDays", getU16Codec()],
    ]);

    public static serialize(account: CheckerRewardsVault): Uint8Array {
        const data = this.DataCodecV1.encode(account);
        const result = new Uint8Array(1 + data.length);
        result[0] = DepinAccountType.CheckerRewardsVault;
        result.set(data, 1);
        return result;
    }

    public static deserializeFrom(accountData: ArrayLike<number>): CheckerRewardsVault;
    public static deserializeFrom(accountDataBase58: Base58EncodedBytes): CheckerRewardsVault;
    public static deserializeFrom(accountData: ArrayLike<number> | Base58EncodedBytes): CheckerRewardsVault {
        let accountDataBuffer: ArrayLike<number>;

        if (typeof accountData === 'string') {
            accountDataBuffer = getBase58Codec().encode(accountData);
        } else {
            accountDataBuffer = accountData;
        }

        const accountDiscriminator = accountDataBuffer[0];
        if (accountDiscriminator !== DepinAccountType.CheckerRewardsVault) {
            throw new Error(`Invalid discriminator: ${accountDiscriminator}`);
        }

        const data = Buffer.from(accountDataBuffer).subarray(1);
        const result = this.DataCodecV1.decode(data);
        return result;
    }

    public static async readFromState(
        getAccountData: (address: Address) => Promise<Uint8Array | Base58EncodedBytes | null>
    ): Promise<{ address: Address; data: CheckerRewardsVault } | null> {
        const [addr] = await this.findPDA();
        const raw = await getAccountData(addr);
        if (!raw) return null;
        const decoded = (typeof raw === 'string')
            ? this.deserializeFrom(raw as Base58EncodedBytes)
            : this.deserializeFrom(raw as ArrayLike<number>);
        return { address: addr as Address, data: decoded };
    }
}