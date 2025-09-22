import {
    AccountRole,
    Address,
    address,
    Codec,
    getStructCodec
} from "gill";

import { AssetWithProof } from "@metaplex-foundation/mpl-bubblegum";
import { DEPIN_PROGRAM, MPL_ACCOUNT_COMPRESSION_PROGRAM, SYSTEM_PROGRAM_ADDRESS } from "../../constants.js";
import { DepinInstruction } from "../../enums.js";
import { assetToCNftContext, CNftContext, CNftContextCodec } from "../../utils/bubblegum.js";
import { getCurrentPeriod } from "../../utils/bmb.js";
import { GlobalRewardsAccount } from "../global/global-rewards-account.js";
import { LockedTokensAccount } from "../treasury/locked-tokens-account.js";
import { TreasuryAuthority } from "../treasury/treasury-authority.js";
import { TreasuryConfigAccount } from "../treasury/treasury-config-account.js";
import { TreasuryStateAccount } from "../treasury/treasury-state-account.js";
import { CheckerLicenseMetadataAccount } from "./checker-license-metadata-account.js";
import { CheckerMetadataAccount } from "./checker-metadata-account.js";

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

    public async getInstruction(treasuryConfig: { address: Address; data: TreasuryConfigAccount }, currentPeriod?: number) {
        const globalRewardsPda = await GlobalRewardsAccount.findGlobalRewardsPDA();
        const checkerMetadataPda = await CheckerMetadataAccount.findCheckerMetadataPDA(
            address(this.checker_license.rpcAsset.id),
            address(this.params.license_context.owner)
        );
        const checkerLicenseMetadataPda = await CheckerLicenseMetadataAccount.findCheckerLicenseMetadataPDA(
            address(this.checker_license.rpcAsset.id)
        );
        const treasuryStatePda = await TreasuryStateAccount.findTreasuryStatePDA();
        const treasuryAtaPda = await TreasuryAuthority.findAssociatedTokenAccount();

        if (!currentPeriod) {
            currentPeriod = getCurrentPeriod();
        }
        console.log("PayoutCheckerRewards.getInstruction currentPeriod", currentPeriod);
        // Read lock duration from provided TreasuryConfig account
        const lockDays = treasuryConfig.data.checkerRewardsLockDays;
        const lockedTokensPda = await LockedTokensAccount.findLockedTokensPDA(
            this.params.license_context.owner,
            currentPeriod,
            currentPeriod + lockDays
        );

        let accounts = [
            { address: this.signer, role: AccountRole.READONLY_SIGNER },
            { address: globalRewardsPda[0], role: AccountRole.WRITABLE },
            { address: checkerMetadataPda[0], role: AccountRole.WRITABLE },
            { address: checkerLicenseMetadataPda[0], role: AccountRole.READONLY },
            { address: MPL_ACCOUNT_COMPRESSION_PROGRAM, role: AccountRole.READONLY },
            { address: address(this.checker_license.merkleTree), role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: treasuryStatePda[0], role: AccountRole.WRITABLE },
            { address: treasuryAtaPda[0], role: AccountRole.WRITABLE },
            { address: treasuryConfig.address, role: AccountRole.READONLY },
            { address: lockedTokensPda[0], role: AccountRole.WRITABLE },
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
