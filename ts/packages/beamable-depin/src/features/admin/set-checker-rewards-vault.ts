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
import { CheckerRewardsVault } from "../rewards/checker-rewards-vault.js";

export interface SetCheckerRewardsVaultParams {
    lock_days: Option<number>;
}

export const SetCheckerRewardsVaultParamsCodec: Codec<SetCheckerRewardsVaultParams> = getStructCodec([
    ["lock_days", getOptionCodec(getU16Codec())],
]);

export interface CreateSetCheckerRewardsVaultInput {
    signer: Address;
    lock_days?: number;
}

export class SetCheckerRewardsVault {
    signer: Address;
    readonly params: SetCheckerRewardsVaultParams;

    constructor(input: CreateSetCheckerRewardsVaultInput) {
        this.params = {
            lock_days: input.lock_days ? some(input.lock_days) : none(),
        };

        this.signer = input.signer;
    }

    private serialize(): Uint8Array {
        const inner = SetCheckerRewardsVaultParamsCodec.encode(this.params);
        return Uint8Array.of(DepinInstruction.SetCheckerRewardsVault, ...inner);
    }

    public async getInstruction() {
        const checkerRewardsVaultPda = await CheckerRewardsVault.findPDA();

        // Calculate ProgramData PDA for upgrade authority verification
        const programDataAddress = await getProgramDataAddress(DEPIN_PROGRAM);

        let accounts = [
            { address: this.signer, role: AccountRole.WRITABLE_SIGNER },
            { address: programDataAddress, role: AccountRole.READONLY },
            { address: checkerRewardsVaultPda[0], role: AccountRole.WRITABLE },
        ];

        return {
            programAddress: DEPIN_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
