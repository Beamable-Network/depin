import {
    AccountRole,
    Codec,
    getStructCodec,
    type Address
} from "gill";

import { BMB_MINT, DEPIN_PROGRAM } from "../../constants.js";
import { DepinInstruction } from "../../enums.js";
import { GlobalRewardsAccount } from "../rewards/global-rewards-account.js";
import { DepinTreasuryStateAccount } from "../treasury/depin-treasury-state-account.js";
import { DepinTreasuryConfigAccount } from "../treasury/depin-treasury-config-account.js";
import { BMBStateAccount } from "../global/bmb-state-account.js";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { FlexlockVaultAuthority, getProgramDataAddress } from "../../index.js";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

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
        const treasuryStatePda = await DepinTreasuryStateAccount.findTreasuryStatePDA();
        const treasuryConfigPda = await DepinTreasuryConfigAccount.findTreasuryConfigPDA();
        const bmbStatePda = await BMBStateAccount.findPDA();

        const flexLockVault = await FlexlockVaultAuthority.findFlexlockVaultPDA();
        const flexLockVaultBmbAta = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: flexLockVault[0],
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        // Calculate ProgramData PDA for upgrade authority verification
        const programDataAddress = await getProgramDataAddress(DEPIN_PROGRAM);

        let accounts = [
            { address: this.payer, role: AccountRole.READONLY_SIGNER },
            { address: programDataAddress, role: AccountRole.READONLY },
            { address: globalRewardsPda[0], role: AccountRole.WRITABLE },
            { address: treasuryStatePda[0], role: AccountRole.WRITABLE },
            { address: treasuryConfigPda[0], role: AccountRole.WRITABLE },
            { address: bmbStatePda[0], role: AccountRole.WRITABLE },
            { address: BMB_MINT, role: AccountRole.READONLY },
            { address: flexLockVault[0], role: AccountRole.WRITABLE },
            { address: flexLockVaultBmbAta[0], role: AccountRole.WRITABLE },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }
        ];
        return {
            programAddress: DEPIN_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
