import {
    AccountRole,
    Address,
    address,
    Codec,
    getStructCodec
} from "gill";

import { AssetWithProof } from "@metaplex-foundation/mpl-bubblegum";
import { BMB_MINT, DEPIN_PROGRAM, MPL_ACCOUNT_COMPRESSION_PROGRAM, SYSTEM_PROGRAM_ADDRESS } from "../../constants.js";
import { DepinInstruction } from "../../enums.js";
import { assetToCNftContext, CNftContext, CNftContextCodec } from "../../utils/bubblegum.js";
import { getCurrentPeriod } from "../../utils/bmb.js";
import { GlobalRewardsAccount } from "../rewards/global-rewards-account.js";
import { CheckerRewardsVault } from "../rewards/checker-rewards-vault.js";
import { CheckerLicenseMetadataAccount } from "./checker-license-metadata-account.js";
import { CheckerMetadataAccount } from "./checker-metadata-account.js";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { FlexlockTokensAccount } from "../flexlock/flexlock-tokens-account.js";
import { FlexlockVault } from "../flexlock/flexlock-vault.js";

export interface PayoutCheckerRewardsParams {
    license_context: CNftContext;
}

export const PayoutCheckerRewardsParamsCodec: Codec<PayoutCheckerRewardsParams> = getStructCodec([
    ["license_context", CNftContextCodec],
]);

export interface CreatePayoutCheckerRewardsInput {
    signer: Address;
    checker_license: AssetWithProof;
}

export class PayoutCheckerRewards {
    signer: Address;
    readonly checker_license: AssetWithProof;
    readonly params: PayoutCheckerRewardsParams;

    constructor(input: CreatePayoutCheckerRewardsInput) {
        this.params = {
            license_context: assetToCNftContext(input.checker_license),
        };

        this.checker_license = input.checker_license;
        this.signer = input.signer;
    }

    private serialize(): Uint8Array {
        const inner = PayoutCheckerRewardsParamsCodec.encode(this.params);
        return Uint8Array.of(DepinInstruction.PayoutCheckerRewards, ...inner);
    }

    public async getInstruction(checkerRewardsVault: { address: Address; data: CheckerRewardsVault }, currentPeriod?: number) {
        const globalRewardsPda = await GlobalRewardsAccount.findGlobalRewardsPDA();
        const checkerMetadataPda = await CheckerMetadataAccount.findCheckerMetadataPDA(
            address(this.checker_license.rpcAsset.id),
            address(this.params.license_context.owner)
        );
        const checkerLicenseMetadataPda = await CheckerLicenseMetadataAccount.findCheckerLicenseMetadataPDA(
            address(this.checker_license.rpcAsset.id)
        );

        // Get CheckerRewardsVault PDA (sender for flexlock)
        const checkerRewardsVaultPda = await CheckerRewardsVault.findPDA();
        const checkerRewardsVaultAta = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: checkerRewardsVaultPda[0],
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        // Get FlexlockVault PDA and its ATA
        const flexlockVaultPda = await FlexlockVault.findFlexlockVaultPDA();
        const flexlockVaultAta = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: flexlockVaultPda[0],
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        if (!currentPeriod) {
            currentPeriod = getCurrentPeriod();
        }

        // Read lock duration from provided CheckerRewardsVault account
        const lockDays = checkerRewardsVault.data.lockDays;
        const unlockPeriod = currentPeriod + lockDays;

        // Derive FlexlockTokens PDA
        const flexlockTokensPda = await FlexlockTokensAccount.findFlexlockTokensPDA(
            checkerRewardsVaultPda[0],  // sender
            this.params.license_context.owner,  // receiver
            currentPeriod,  // lock_period
            unlockPeriod    // unlock_period
        );

        let accounts = [
            { address: this.signer, role: AccountRole.READONLY_SIGNER },
            { address: globalRewardsPda[0], role: AccountRole.WRITABLE },
            { address: checkerMetadataPda[0], role: AccountRole.WRITABLE },
            { address: checkerLicenseMetadataPda[0], role: AccountRole.READONLY },
            { address: MPL_ACCOUNT_COMPRESSION_PROGRAM, role: AccountRole.READONLY },
            { address: address(this.checker_license.merkleTree), role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: checkerRewardsVaultPda[0], role: AccountRole.WRITABLE },
            { address: checkerRewardsVaultAta[0], role: AccountRole.WRITABLE },
            { address: flexlockTokensPda[0], role: AccountRole.WRITABLE },
            { address: flexlockVaultAta[0], role: AccountRole.WRITABLE },
            { address: BMB_MINT, role: AccountRole.READONLY },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ...this.checker_license.proof.map(proof => ({
                address: address(proof),
                role: AccountRole.READONLY
            }))
        ];

        return {
            programAddress: DEPIN_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
