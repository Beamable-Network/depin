import {
    AccountRole,
    Address,
    Codec,
    getAddressCodec,
    getStructCodec,
    getU16Codec,
    getU64Codec,
} from "gill";

import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { BMB_MINT, DEPIN_PROGRAM, SYSTEM_PROGRAM_ADDRESS } from "../../constants.js";
import { DepinInstruction } from "../../enums.js";
import { FlexlockTokensAccount } from "./flexlock-tokens-account.js";
import { FlexlockVaultAuthority } from "./flexlock-vault-authority.js";

export interface FlexLockParams {
    receiver: Address;
    amount: bigint;
    lock_duration_days: number;
}

export const FlexLockParamsCodec: Codec<FlexLockParams> = getStructCodec([
    ["receiver", getAddressCodec()],
    ["amount", getU64Codec()],
    ["lock_duration_days", getU16Codec()],
]);

export interface CreateFlexLockInput {
    sender: Address;  // The sender who is locking the tokens
    receiver: Address;  // The receiver who will be able to unlock the tokens
    amount: bigint;  // Amount of BMB tokens to lock
    lock_duration_days: number;  // Duration in days (e.g., 365 for 12 months)
    sender_bmb_token_account: Address; // Address of sender's BMB token account
    current_period: number;  // Current period for PDA derivation
}

export class FlexLock {
    readonly sender: Address;
    readonly params: FlexLockParams;
    readonly sender_bmb_token_account: Address;
    readonly current_period: number;

    constructor(input: CreateFlexLockInput) {
        this.params = {
            receiver: input.receiver,
            amount: input.amount,
            lock_duration_days: input.lock_duration_days,
        };

        this.sender = input.sender;
        this.sender_bmb_token_account = input.sender_bmb_token_account;
        this.current_period = input.current_period;
    }

    private serialize(): Uint8Array {
        const inner = FlexLockParamsCodec.encode(this.params);
        return Uint8Array.of(DepinInstruction.FlexLock, ...inner);
    }

    public async getInstruction() {
        const unlock_period = this.current_period + this.params.lock_duration_days;

        const flexlockVaultAuthorityPda = await FlexlockVaultAuthority.findFlexlockVaultPDA();
        const flexlockVaultAta = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: flexlockVaultAuthorityPda[0],
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        const flexlockTokensPda = await FlexlockTokensAccount.findFlexlockTokensPDA(
            this.sender,
            this.params.receiver,
            this.current_period,
            unlock_period
        );

        let accounts = [
            { address: this.sender, role: AccountRole.WRITABLE_SIGNER },
            { address: this.sender_bmb_token_account, role: AccountRole.WRITABLE },
            { address: flexlockTokensPda[0], role: AccountRole.WRITABLE },
            { address: flexlockVaultAta[0], role: AccountRole.WRITABLE },
            { address: BMB_MINT, role: AccountRole.READONLY },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ];

        return {
            programAddress: DEPIN_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
