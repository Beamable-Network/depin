import {
    AccountRole,
    Codec,
    getStructCodec,
    type Address
} from "gill";

import { DEPIN_PROGRAM } from "../../constants.js";
import { DepinInstruction } from "../../enums.js";
import { GlobalRewardsAccount } from "../global/global-rewards-account.js";
import { TreasuryStateAccount } from "../treasury/treasury-state-account.js";
import { TreasuryConfigAccount } from "../treasury/treasury-config-account.js";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";

export interface IntNetworkParams {
}

export const IntNetworkParamsCodec: Codec<IntNetworkParams> = getStructCodec([
]);

export class InitNetwork {
    payer: Address;
    readonly params: IntNetworkParams;

    constructor(payer: Address) {
        this.params = {};
        this.payer = payer;
    }

    private serialize(): Uint8Array {
        const inner = IntNetworkParamsCodec.encode(this.params);
        return Uint8Array.of(DepinInstruction.InitNetwork, ...inner);
    }

    public async getInstruction() {
        const globalRewardsPda = await GlobalRewardsAccount.findGlobalRewardsPDA();
        const treasuryStatePda = await TreasuryStateAccount.findTreasuryStatePDA();
        const treasuryConfigPda = await TreasuryConfigAccount.findTreasuryConfigPDA();
        
        let accounts = [
            { address: this.payer, role: AccountRole.READONLY_SIGNER },
            { address: globalRewardsPda[0], role: AccountRole.WRITABLE },
            { address: treasuryStatePda[0], role: AccountRole.WRITABLE },
            { address: treasuryConfigPda[0], role: AccountRole.WRITABLE },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }
        ];
        return {
            programAddress: DEPIN_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
