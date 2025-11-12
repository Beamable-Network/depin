import {
    AccountRole,
    Address,
    Codec,
    getStructCodec,
    getU16Codec,
    getU64Codec
} from "gill";

import { DEPIN_PROGRAM } from "../../constants.js";
import { DepinInstruction } from "../../enums.js";
import { queryProgramReturnData } from "../../utils/client.js";
import { BMBStateAccount } from "../global/bmb-state-account.js";

export interface ViewCheckerRewardParams {
    period: number;
}

export const ViewCheckerRewardParamsCodec: Codec<ViewCheckerRewardParams> = getStructCodec([
    ["period", getU16Codec()],
]);

export interface CreateViewCheckerRewardInput {
    period: number;
}

export class ViewCheckerReward {
    readonly params: ViewCheckerRewardParams;

    constructor(input: CreateViewCheckerRewardInput) {
        this.params = {
            period: input.period,
        };
    }

    private serialize(): Uint8Array {
        const inner = ViewCheckerRewardParamsCodec.encode(this.params);
        return Uint8Array.of(DepinInstruction.ViewCheckerReward, ...inner);
    }

    public async getInstruction() {
        const bmbStatePda = await BMBStateAccount.findPDA();

        let accounts = [
            { address: bmbStatePda[0], role: AccountRole.READONLY },
        ];

        return {
            programAddress: DEPIN_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}

export async function getCheckerReward(
    rpcUrl: string,
    caller: Address,
    period: number
): Promise<bigint> {
    const viewReward = new ViewCheckerReward({ period });
    const instruction = await viewReward.getInstruction();
    const returnData = await queryProgramReturnData(rpcUrl, caller, instruction);
    return getU64Codec().decode(returnData);
}
