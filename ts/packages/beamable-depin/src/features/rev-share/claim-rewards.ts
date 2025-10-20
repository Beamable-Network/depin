import {
    AccountRole,
    Address,
    Codec,
    getStructCodec,
    getU32Codec,
} from "gill";

import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { REV_SHARE_PROGRAM } from "./rev-share-constants.js";
import { RevShareInstruction } from "./rev-share-enums.js";
import { RevShareOfferAccount } from "./rev-share-offer-account.js";
import { UserStakePositionAccount } from "./user-stake-position-account.js";
import { RevShareAuthority } from "./authority.js";

export interface ClaimRewardsParams {
    offer_id: number;
}

export const ClaimRewardsParamsCodec: Codec<ClaimRewardsParams> = getStructCodec([
    ["offer_id", getU32Codec()],
]);

export interface CreateClaimRewardsInput {
    user: Address;
    offer_id: number;
    user_usdc_token_account: Address;
}

export class ClaimRewards {
    readonly user: Address;
    readonly params: ClaimRewardsParams;
    readonly user_usdc_token_account: Address;

    constructor(input: CreateClaimRewardsInput) {
        this.user = input.user;
        this.params = {
            offer_id: input.offer_id,
        };
        this.user_usdc_token_account = input.user_usdc_token_account;
    }

    private serialize(): Uint8Array {
        const inner = ClaimRewardsParamsCodec.encode(this.params);
        return Uint8Array.of(RevShareInstruction.ClaimRewards, ...inner);
    }

    public async getInstruction() {
        const userPositionPda = await UserStakePositionAccount.findUserStakePositionPDA(this.user);
        const claimOfferPda = await RevShareOfferAccount.findOfferPDA(this.params.offer_id);
        const authorityPda = await RevShareAuthority.findAuthorityPDA();
        const usdcTreasuryAta = await RevShareAuthority.findUsdcTreasuryATA();

        let accounts = [
            { address: this.user, role: AccountRole.READONLY_SIGNER },
            { address: userPositionPda[0], role: AccountRole.WRITABLE },
            { address: claimOfferPda[0], role: AccountRole.READONLY },
            { address: authorityPda[0], role: AccountRole.READONLY },
            { address: this.user_usdc_token_account, role: AccountRole.WRITABLE },
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
