import {
    AccountRole,
    Address,
    Codec,
    getStructCodec,
    getU64Codec,
} from "gill";

import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { REV_SHARE_PROGRAM } from "./rev-share-constants.js";
import { RevShareInstruction } from "./rev-share-enums.js";
import { GlobalStateAccount } from "./global-state-account.js";
import { RevShareOfferAccount } from "./rev-share-offer-account.js";
import { UserStakePositionAccount } from "./user-stake-position-account.js";
import { RevShareAuthority } from "./authority.js";

export interface StakeParams {
    amount: bigint;
}

export const StakeParamsCodec: Codec<StakeParams> = getStructCodec([
    ["amount", getU64Codec()],
]);

export interface CreateStakeInput {
    user: Address;
    payer: Address;
    amount: bigint;
    user_bmb_token_account: Address;
    active_offer_id: number; // The current active offer ID
}

export class Stake {
    readonly user: Address;
    readonly payer: Address;
    readonly params: StakeParams;
    readonly user_bmb_token_account: Address;
    readonly active_offer_id: number;

    constructor(input: CreateStakeInput) {
        this.user = input.user;
        this.payer = input.payer;
        this.params = {
            amount: input.amount,
        };
        this.user_bmb_token_account = input.user_bmb_token_account;
        this.active_offer_id = input.active_offer_id;
    }

    private serialize(): Uint8Array {
        const inner = StakeParamsCodec.encode(this.params);
        return Uint8Array.of(RevShareInstruction.Stake, ...inner);
    }

    public async getInstruction() {
        const userPositionPda = await UserStakePositionAccount.findUserStakePositionPDA(this.user);
        const globalStatePda = await GlobalStateAccount.findGlobalStatePDA();
        const activeOfferPda = await RevShareOfferAccount.findOfferPDA(this.active_offer_id);
        const bmbTreasuryAta = await RevShareAuthority.findBmbTreasuryATA();

        let accounts = [
            { address: this.user, role: AccountRole.READONLY_SIGNER },
            { address: this.payer, role: AccountRole.WRITABLE_SIGNER },
            { address: userPositionPda[0], role: AccountRole.WRITABLE },
            { address: globalStatePda[0], role: AccountRole.READONLY },
            { address: activeOfferPda[0], role: AccountRole.WRITABLE },
            { address: this.user_bmb_token_account, role: AccountRole.WRITABLE },
            { address: bmbTreasuryAta[0], role: AccountRole.WRITABLE },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ];

        return {
            programAddress: REV_SHARE_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
