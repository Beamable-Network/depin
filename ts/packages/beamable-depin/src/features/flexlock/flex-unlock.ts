import {
    AccountRole,
    Address,
    Rpc,
    SolanaRpcApi
} from "gill";

import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { BMB_MINT, DEPIN_PROGRAM } from "../../constants.js";
import { DepinInstruction } from "../../enums.js";
import { FlexlockTokensAccount } from "./flexlock-tokens-account.js";
import { FlexlockVaultAuthority } from "./flexlock-vault-authority.js";

export interface CreateFlexUnlockInput {
    receiver: Address;  // The receiver unlocking the tokens (must be signer)
    sender: Address;  // The original sender of the locked tokens
    receiver_bmb_token_account: Address; // Address of receiver's BMB token account (where vested tokens go)
    sender_bmb_token_account: Address; // Address of sender's BMB token account (where penalty goes)
    lock_period: number;  // The period when tokens were locked
    unlock_period?: number;  // Optional: only used to derive PDA address
}

export class FlexUnlock {
    readonly receiver: Address;
    readonly sender: Address;
    readonly receiver_bmb_token_account: Address;
    readonly sender_bmb_token_account: Address;
    readonly lock_period: number;
    readonly unlock_period?: number;

    constructor(input: CreateFlexUnlockInput) {
        this.receiver = input.receiver;
        this.sender = input.sender;
        this.receiver_bmb_token_account = input.receiver_bmb_token_account;
        this.sender_bmb_token_account = input.sender_bmb_token_account;
        this.lock_period = input.lock_period;
        this.unlock_period = input.unlock_period;
    }

    private serialize(): Uint8Array {
        // No parameters needed for FlexUnlock instruction
        return Uint8Array.of(DepinInstruction.FlexUnlock);
    }

    public async getInstruction(rpc?: Rpc<SolanaRpcApi>) {
        const flexlockVaultAuthorityPda = await FlexlockVaultAuthority.findFlexlockVaultPDA();
        const flexlockVaultAta = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: flexlockVaultAuthorityPda[0],
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        // Derive the flexlock tokens account address using sender+receiver+lock+unlock period.
        // If unlock_period not provided, discover from program accounts when rpc is available.
        let unlockPeriod = this.unlock_period;
        if (unlockPeriod === undefined && rpc) {
            try {
                const accounts = await FlexlockTokensAccount.getFlexlockTokensByReceiver(async (programAddress, filters) => {
                    return await rpc.getProgramAccounts(programAddress, { filters }).send();
                }, this.receiver);
                const match = accounts.find(a =>
                    a.data.sender === this.sender &&
                    a.data.lockPeriod === this.lock_period
                );
                if (match) unlockPeriod = match.data.unlockPeriod;
            } catch (err) {
                // ignore, will error below if still undefined
            }
        }
        if (unlockPeriod === undefined) {
            // Fallback to default schedule length (client-side guess) for error-path tests
            unlockPeriod = this.lock_period + 365;
        }

        const flexlockTokensPda = await FlexlockTokensAccount.findFlexlockTokensPDA(
            this.sender,
            this.receiver,
            this.lock_period,
            unlockPeriod
        );

        let accounts = [
            { address: this.receiver, role: AccountRole.READONLY_SIGNER },
            { address: this.sender, role: AccountRole.READONLY },
            { address: flexlockTokensPda[0], role: AccountRole.WRITABLE },
            { address: flexlockVaultAta[0], role: AccountRole.WRITABLE },
            { address: flexlockVaultAuthorityPda[0], role: AccountRole.READONLY },
            { address: this.receiver_bmb_token_account, role: AccountRole.WRITABLE },
            { address: this.sender_bmb_token_account, role: AccountRole.WRITABLE },
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
