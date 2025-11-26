import {
    AccountRole,
    Address
} from "gill";

import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { BMB_MINT, DEPIN_PROGRAM } from "../../constants.js";
import { DepinInstruction } from "../../enums.js";
import { FlexlockTokensAccount } from "./flexlock-tokens-account.js";
import { FlexlockVault } from "./flexlock-vault.js";

export interface CreateFlexUnlockInput {
    receiver: Address;
    sender: Address;
    receiver_bmb_token_account: Address;
    sender_bmb_token_account: Address;
    lock_period: number;
    rent_receiver: Address;
    unlock_period: number;
}

export class FlexUnlock {
    readonly receiver: Address;
    readonly sender: Address;
    readonly receiver_bmb_token_account: Address;
    readonly sender_bmb_token_account: Address;
    readonly lock_period: number;
    readonly rent_receiver: Address;
    readonly unlock_period: number;
    constructor(input: CreateFlexUnlockInput) {
        this.receiver = input.receiver;
        this.sender = input.sender;
        this.receiver_bmb_token_account = input.receiver_bmb_token_account;
        this.sender_bmb_token_account = input.sender_bmb_token_account;
        this.lock_period = input.lock_period;
        this.rent_receiver = input.rent_receiver;
        this.unlock_period = input.unlock_period;
    }

    private serialize(): Uint8Array {
        // No parameters needed for FlexUnlock instruction
        return Uint8Array.of(DepinInstruction.FlexUnlock);
    }

    public async getInstruction() {
        const flexlockVaultPda = await FlexlockVault.findFlexlockVaultPDA();
        const flexlockVaultAta = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: flexlockVaultPda[0],
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        const flexlockTokensPda = await FlexlockTokensAccount.findFlexlockTokensPDA(
            this.sender,
            this.receiver,
            this.lock_period,
            this.unlock_period
        );

        let accounts = [
            { address: this.receiver, role: AccountRole.READONLY_SIGNER },
            { address: this.sender, role: AccountRole.WRITABLE },
            { address: flexlockTokensPda[0], role: AccountRole.WRITABLE },
            { address: flexlockVaultAta[0], role: AccountRole.WRITABLE },
            { address: flexlockVaultPda[0], role: AccountRole.READONLY },
            { address: this.receiver_bmb_token_account, role: AccountRole.WRITABLE },
            { address: this.sender_bmb_token_account, role: AccountRole.WRITABLE },
            { address: this.rent_receiver, role: AccountRole.WRITABLE },
            { address: BMB_MINT, role: AccountRole.READONLY },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ];

        return {
            programAddress: DEPIN_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
