import {
    AccountRole,
    Address,
} from "gill";

import { REV_SHARE_PROGRAM } from "./rev-share-constants.js";
import { RevShareInstruction } from "./rev-share-enums.js";
import { OfferBookAccount } from "./offer-book-account.js";
import { UserStakePositionAccount } from "./user-stake-position-account.js";

export interface CreateOptOutRolloverInput {
    user: Address;
}

export class OptOutRollover {
    readonly user: Address;

    constructor(input: CreateOptOutRolloverInput) {
        this.user = input.user;
    }

    private serialize(): Uint8Array {
        return Uint8Array.of(RevShareInstruction.OptOutRollover);
    }

    public async getInstruction() {
        const userPositionPda = await UserStakePositionAccount.findUserStakePositionPDA(this.user);
        const offerBookPda = await OfferBookAccount.findOfferBookPDA();

        let accounts = [
            { address: this.user, role: AccountRole.READONLY_SIGNER },
            { address: userPositionPda[0], role: AccountRole.WRITABLE },
            { address: offerBookPda[0], role: AccountRole.WRITABLE },
        ];

        return {
            programAddress: REV_SHARE_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
