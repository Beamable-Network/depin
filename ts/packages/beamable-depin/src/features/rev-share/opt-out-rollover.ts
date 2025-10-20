import {
    AccountRole,
    Address,
} from "gill";

import { REV_SHARE_PROGRAM } from "./rev-share-constants.js";
import { RevShareInstruction } from "./rev-share-enums.js";
import { GlobalStateAccount } from "./global-state-account.js";
import { RevShareOfferAccount } from "./rev-share-offer-account.js";
import { UserStakePositionAccount } from "./user-stake-position-account.js";

export interface CreateOptOutRolloverInput {
    user: Address;
    active_offer_id: number;
}

export class OptOutRollover {
    readonly user: Address;
    readonly active_offer_id: number;

    constructor(input: CreateOptOutRolloverInput) {
        this.user = input.user;
        this.active_offer_id = input.active_offer_id;
    }

    private serialize(): Uint8Array {
        return Uint8Array.of(RevShareInstruction.OptOutRollover);
    }

    public async getInstruction() {
        const userPositionPda = await UserStakePositionAccount.findUserStakePositionPDA(this.user);
        const globalStatePda = await GlobalStateAccount.findGlobalStatePDA();
        const activeOfferPda = await RevShareOfferAccount.findOfferPDA(this.active_offer_id);

        let accounts = [
            { address: this.user, role: AccountRole.READONLY_SIGNER },
            { address: userPositionPda[0], role: AccountRole.WRITABLE },
            { address: globalStatePda[0], role: AccountRole.READONLY },
            { address: activeOfferPda[0], role: AccountRole.WRITABLE },
        ];

        return {
            programAddress: REV_SHARE_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
