import {
    AccountRole,
    Address,
    Codec,
    getStructCodec,
    getU32Codec,
    getI64Codec,
    getU16Codec,
} from "gill";

import { TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { REV_SHARE_PROGRAM } from "./rev-share-constants.js";
import { RevShareInstruction } from "./rev-share-enums.js";
import { OfferBookAccount } from "./offer-book-account.js";
import { RevShareAuthority } from "./authority.js";
import { BMB_MINT, USDC_MINT } from "../../constants.js";

export interface InitializeOfferParams {
    offer_id: number;
    start_time: bigint;
    end_time: bigint;
    revenue_percentage: number;
}

export const InitializeOfferParamsCodec: Codec<InitializeOfferParams> = getStructCodec([
    ["offer_id", getU32Codec()],
    ["start_time", getI64Codec()],
    ["end_time", getI64Codec()],
    ["revenue_percentage", getU16Codec()],
]);

export interface CreateInitializeOfferInput {
    admin: Address;
    payer: Address;
    offer_id: number;
    start_time: bigint;
    end_time: bigint;
    revenue_percentage: number;
}

export class InitializeOffer {
    readonly admin: Address;
    readonly payer: Address;
    readonly params: InitializeOfferParams;

    constructor(input: CreateInitializeOfferInput) {
        this.admin = input.admin;
        this.payer = input.payer;
        this.params = {
            offer_id: input.offer_id,
            start_time: input.start_time,
            end_time: input.end_time,
            revenue_percentage: input.revenue_percentage,
        };
    }

    private serialize(): Uint8Array {
        const inner = InitializeOfferParamsCodec.encode(this.params);
        return Uint8Array.of(RevShareInstruction.InitializeOffer, ...inner);
    }

    public async getInstruction() {
        const offerBookPda = await OfferBookAccount.findOfferBookPDA();
        const authorityPda = await RevShareAuthority.findAuthorityPDA();
        const bmbTreasuryAta = await RevShareAuthority.findBmbTreasuryATA();
        const usdcTreasuryAta = await RevShareAuthority.findUsdcTreasuryATA();

        let accounts = [
            { address: this.admin, role: AccountRole.READONLY_SIGNER },
            { address: this.payer, role: AccountRole.WRITABLE_SIGNER },
            { address: offerBookPda[0], role: AccountRole.WRITABLE },
            { address: authorityPda[0], role: AccountRole.READONLY },
            { address: bmbTreasuryAta[0], role: AccountRole.WRITABLE },
            { address: usdcTreasuryAta[0], role: AccountRole.WRITABLE },
            { address: BMB_MINT, role: AccountRole.READONLY },
            { address: USDC_MINT, role: AccountRole.READONLY },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ];

        return {
            programAddress: REV_SHARE_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
