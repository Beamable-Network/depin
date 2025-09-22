import {
    AccountRole,
    Address,
    Codec,
    Endian,
    getStructCodec,
    getU16Codec,
    getU32Codec
} from "gill";

import { DEPIN_PROGRAM, SYSTEM_PROGRAM_ADDRESS } from "../../constants.js";
import { DepinInstruction } from "../../enums.js";
import { BMBStateAccount } from "./bmb-state-account.js";

export interface ActivateCheckerLicensesParams {
    period: number;
    checker_count: number;
}

export const ActivateCheckersParamsCodec: Codec<ActivateCheckerLicensesParams> = getStructCodec([
    ["period", getU16Codec({ endian: Endian.Little })],
    ["checker_count", getU32Codec({ endian: Endian.Little })],
]);

export interface CreateActivateCheckerLicensesInput {
    signer: Address;
    period: number;
    checker_count: number;
}

export class ActivateCheckerLicenses {
    signer: Address;
    readonly params: ActivateCheckerLicensesParams;

    constructor(input: CreateActivateCheckerLicensesInput) {
        this.params = {
            period: input.period,
            checker_count: input.checker_count,
        };

        this.signer = input.signer;
    }

    private serialize(): Uint8Array {
        const inner = ActivateCheckersParamsCodec.encode(this.params);
        return Uint8Array.of(DepinInstruction.ActivateCheckerLicenses, ...inner);
    }

    public async getInstruction() {
        const bmbStatePda = await BMBStateAccount.findPDA();

        let accounts = [
            { address: this.signer, role: AccountRole.READONLY_SIGNER },
            { address: bmbStatePda[0], role: AccountRole.WRITABLE },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ];

        return {
            programAddress: DEPIN_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
