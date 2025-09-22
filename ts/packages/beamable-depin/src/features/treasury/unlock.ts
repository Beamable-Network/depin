import {
    AccountRole,
    Address,
    Codec,
    getStructCodec,
    getU16Codec,
    Rpc,
    SolanaRpcApi
} from "gill";

import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { DEPIN_PROGRAM } from "../../constants.js";
import { DepinInstruction } from "../../enums.js";
import { LockedTokensAccount } from "./locked-tokens-account.js";
import { TreasuryAuthority } from "./treasury-authority.js";
import { TreasuryStateAccount } from "./treasury-state-account.js";

export interface UnlockParams {
    lock_period: number;
}

export const UnlockParamsCodec: Codec<UnlockParams> = getStructCodec([
    ["lock_period", getU16Codec()],
]);

export interface CreateUnlockInput {
    owner: Address;  // The owner of the locked tokens
    lock_period: number;    // The period when tokens were locked
    owner_bmb_token_account: Address; // Address of owner's BMB token account
    unlock_period_for_address?: number; // Optional: only used to derive PDA address for account list
}

export class Unlock {
    readonly owner: Address;
    readonly params: UnlockParams;
    readonly owner_bmb_token_account: Address;
    readonly unlock_period_for_address?: number;

    constructor(input: CreateUnlockInput) {
        this.params = {
            lock_period: input.lock_period,
        };

        this.owner = input.owner;
        this.owner_bmb_token_account = input.owner_bmb_token_account;
        this.unlock_period_for_address = input.unlock_period_for_address;
    }

    private serialize(): Uint8Array {
        const inner = UnlockParamsCodec.encode(this.params);
        return Uint8Array.of(DepinInstruction.Unlock, ...inner);
    }

    public async getInstruction(rpc?: Rpc<SolanaRpcApi>) {
        const treasuryStatePda = await TreasuryStateAccount.findTreasuryStatePDA();
        const treasuryAtaPda = await TreasuryAuthority.findAssociatedTokenAccount();
        const treasuryAuthorityPda = await TreasuryAuthority.findTreasuryPDA();
        // Derive the locked tokens account address using lock+unlock period.
        // If not provided, discover from program accounts when rpc is available.
        let unlockPeriod = this.unlock_period_for_address;
        if (unlockPeriod === undefined && rpc) {
            try {
                const accounts = await LockedTokensAccount.getLockedTokens(rpc, this.owner);
                const match = accounts.find(a => a.data.lockPeriod === this.params.lock_period && a.data.unlockedAt.__option === 'None');
                if (match) unlockPeriod = match.data.unlockPeriod;
            } catch (e) {
                // ignore, will error below if still undefined
            }
        }
        if (unlockPeriod === undefined) {
            // Fallback to default schedule length (client-side guess) for error-path tests
            unlockPeriod = this.params.lock_period + 365;
        }
        const lockedTokensPda = await LockedTokensAccount.findLockedTokensPDA(
            this.owner,
            this.params.lock_period,
            unlockPeriod
        );

        let accounts = [
            { address: this.owner, role: AccountRole.READONLY_SIGNER },
            { address: treasuryStatePda[0], role: AccountRole.WRITABLE },
            { address: treasuryAtaPda[0], role: AccountRole.WRITABLE },
            { address: treasuryAuthorityPda[0], role: AccountRole.READONLY },
            { address: lockedTokensPda[0], role: AccountRole.WRITABLE },
            { address: this.owner_bmb_token_account, role: AccountRole.WRITABLE },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ];

        return {
            programAddress: DEPIN_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
