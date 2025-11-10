import {
    AccountRole,
    Address,
    Codec,
    getOptionCodec,
    getStructCodec,
    getU16Codec,
    none,
    Option,
    some
} from "gill";

import { DEPIN_PROGRAM } from "../../constants.js";
import { DepinInstruction } from "../../enums.js";
import { getProgramDataAddress } from "../../index.js";
import { TreasuryConfigAccount } from "../treasury/treasury-config-account.js";

export interface SetTreasuryConfigParams {
    checker_rewards_lock_days: Option<number>;
}

export const SetTreasuryConfigParamsCodec: Codec<SetTreasuryConfigParams> = getStructCodec([
    ["checker_rewards_lock_days", getOptionCodec(getU16Codec())],
]);

export interface CreateSetTreasuryConfigInput {
    signer: Address;
    checker_rewards_lock_days?: number;
}

export class SetTreasuryConfig {
    signer: Address;
    readonly params: SetTreasuryConfigParams;

    constructor(input: CreateSetTreasuryConfigInput) {
        this.params = {
            checker_rewards_lock_days: input.checker_rewards_lock_days ? some(input.checker_rewards_lock_days) : none(),
        };

        this.signer = input.signer;
    }

    private serialize(): Uint8Array {
        const inner = SetTreasuryConfigParamsCodec.encode(this.params);
        return Uint8Array.of(DepinInstruction.SetTreasuryConfig, ...inner);
    }

    public async getInstruction() {
        const treasuryConfigPda = await TreasuryConfigAccount.findTreasuryConfigPDA();

        // Calculate ProgramData PDA for upgrade authority verification
        const programDataAddress = await getProgramDataAddress(DEPIN_PROGRAM);

        let accounts = [
            { address: this.signer, role: AccountRole.WRITABLE_SIGNER },
            { address: programDataAddress, role: AccountRole.READONLY },
            { address: treasuryConfigPda[0], role: AccountRole.WRITABLE },
        ];

        return {
            programAddress: DEPIN_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
