import {
    AccountRole,
    Address,
    Codec,
    getOptionCodec,
    getStructCodec,
    getU32Codec,
    none,
    Option,
    some
} from "gill";

import { DEPIN_PROGRAM } from "../../constants.js";
import { DepinInstruction } from "../../enums.js";
import { getProgramDataAddress } from "../../index.js";
import { BMBStateAccount } from "../global/bmb-state-account.js";

export interface SetBMBStateParams {
    checkers_desired: Option<number>;
    checkers_activated: Option<number>;
    workers_activated: Option<number>;
}

export const SetBMBStateParamsCodec: Codec<SetBMBStateParams> = getStructCodec([
    ["checkers_desired", getOptionCodec(getU32Codec())],
    ["checkers_activated", getOptionCodec(getU32Codec())],
    ["workers_activated", getOptionCodec(getU32Codec())],
]);

export interface CreateSetBMBStateInput {
    signer: Address;
    checkers_desired?: number;
    checkers_activated?: number;
    workers_activated?: number;
}

export class SetBMBState {
    signer: Address;
    readonly params: SetBMBStateParams;

    constructor(input: CreateSetBMBStateInput) {
        this.params = {
            checkers_desired: input.checkers_desired ? some(input.checkers_desired) : none(),
            checkers_activated: input.checkers_activated ? some(input.checkers_activated) : none(),
            workers_activated: input.workers_activated ? some(input.workers_activated) : none(),
        };

        this.signer = input.signer;
    }

    private serialize(): Uint8Array {
        const inner = SetBMBStateParamsCodec.encode(this.params);
        return Uint8Array.of(DepinInstruction.SetBMBState, ...inner);
    }

    public async getInstruction() {
        const bmbStatePda = await BMBStateAccount.findPDA();

        // Calculate ProgramData PDA for upgrade authority verification
        const programDataAddress = await getProgramDataAddress(DEPIN_PROGRAM);

        let accounts = [
            { address: this.signer, role: AccountRole.WRITABLE_SIGNER },
            { address: programDataAddress, role: AccountRole.READONLY },
            { address: bmbStatePda[0], role: AccountRole.WRITABLE },
        ];

        return {
            programAddress: DEPIN_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
