import {
    AccountRole,
    Address,
    Codec,
    getStructCodec,
    getU64Codec,
} from "gill";

import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { REV_SHARE_PROGRAM } from "./rev-share-constants.js";
import { RevShareInstruction } from "./rev-share-enums.js";
import { GlobalStateAccount } from "./global-state-account.js";
import { RevShareOfferAccount } from "./rev-share-offer-account.js";
import { RevShareAuthority } from "./authority.js";

export interface DepositRevenueParams {
    amount: bigint;
}

export const DepositRevenueParamsCodec: Codec<DepositRevenueParams> = getStructCodec([
    ["amount", getU64Codec()],
]);

export interface CreateDepositRevenueInput {
    depositor: Address;
    amount: bigint;
    depositor_usdc_token_account: Address;
    active_offer_id: number;
}

export class DepositRevenue {
    readonly depositor: Address;
    readonly params: DepositRevenueParams;
    readonly depositor_usdc_token_account: Address;
    readonly active_offer_id: number;

    constructor(input: CreateDepositRevenueInput) {
        this.depositor = input.depositor;
        this.params = {
            amount: input.amount,
        };
        this.depositor_usdc_token_account = input.depositor_usdc_token_account;
        this.active_offer_id = input.active_offer_id;
    }

    private serialize(): Uint8Array {
        const inner = DepositRevenueParamsCodec.encode(this.params);
        return Uint8Array.of(RevShareInstruction.DepositRevenue, ...inner);
    }

    public async getInstruction() {
        const globalStatePda = await GlobalStateAccount.findGlobalStatePDA();
        const activeOfferPda = await RevShareOfferAccount.findOfferPDA(this.active_offer_id);
        const usdcTreasuryAta = await RevShareAuthority.findUsdcTreasuryATA();

        let accounts = [
            { address: this.depositor, role: AccountRole.READONLY_SIGNER },
            { address: globalStatePda[0], role: AccountRole.READONLY },
            { address: activeOfferPda[0], role: AccountRole.WRITABLE },
            { address: this.depositor_usdc_token_account, role: AccountRole.WRITABLE },
            { address: usdcTreasuryAta[0], role: AccountRole.WRITABLE },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ];

        return {
            programAddress: REV_SHARE_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
