import {
    AccountRole,
    Address,
} from "gill";

import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { REV_SHARE_PROGRAM } from "./rev-share-constants.js";
import { RevShareInstruction } from "./rev-share-enums.js";
import { OfferBookAccount } from "./offer-book-account.js";
import { UserStakePositionAccount } from "./user-stake-position-account.js";
import { RevShareAuthority } from "./authority.js";

export interface CreateUnstakeInput {
    user: Address;
    user_bmb_token_account: Address;
    opted_out_offer_id: number; // The offer the user opted out during (or most recent if not opted out)
}

export class Unstake {
    readonly user: Address;
    readonly user_bmb_token_account: Address;
    readonly opted_out_offer_id: number;

    constructor(input: CreateUnstakeInput) {
        this.user = input.user;
        this.user_bmb_token_account = input.user_bmb_token_account;
        this.opted_out_offer_id = input.opted_out_offer_id;
    }

    private serialize(): Uint8Array {
        return Uint8Array.of(RevShareInstruction.Unstake);
    }

    public async getInstruction() {
        const userPositionPda = await UserStakePositionAccount.findUserStakePositionPDA(this.user);
        const offerBookPda = await OfferBookAccount.findOfferBookPDA();
        const authorityPda = await RevShareAuthority.findAuthorityPDA();
        const bmbTreasuryAta = await RevShareAuthority.findBmbTreasuryATA();

        let accounts = [
            { address: this.user, role: AccountRole.WRITABLE_SIGNER },
            { address: userPositionPda[0], role: AccountRole.WRITABLE },
            { address: offerBookPda[0], role: AccountRole.WRITABLE },
            { address: authorityPda[0], role: AccountRole.READONLY },
            { address: this.user_bmb_token_account, role: AccountRole.WRITABLE },
            { address: bmbTreasuryAta[0], role: AccountRole.WRITABLE },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ];

        return {
            programAddress: REV_SHARE_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
