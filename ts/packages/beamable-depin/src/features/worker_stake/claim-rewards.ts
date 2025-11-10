import {
    AccountRole,
    Address,
    Codec,
    Endian,
    getAddressEncoder,
    getStructCodec,
    getU16Codec
} from "gill";

import {
    BMB_MINT,
    USDC_MINT,
    WORKER_STAKE_PROGRAM
} from "../../constants.js";
import { WorkerStakeInstruction } from "../../enums.js";
import { WorkerStakeConfigAccount } from "./worker-stake-config-account.js";
import { UserStakePositionAccount } from "./user-stake-position-account.js";
import { MonthlyPoolAccount } from "./monthly-pool-account.js";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TreasuryAuthority } from "../treasury/treasury-authority.js";

export interface ClaimRewardsParams {
    month_period: number;
}

export const ClaimRewardsParamsCodec: Codec<ClaimRewardsParams> = getStructCodec([
    ["month_period", getU16Codec({ endian: Endian.Little })]
]);

export interface CreateClaimRewardsInput {
    user: Address;
    worker_collection: Address;
    month_period: number;
}

export class ClaimRewards {
    user: Address;
    worker_collection: Address;
    readonly params: ClaimRewardsParams;

    constructor(input: CreateClaimRewardsInput) {
        this.params = {
            month_period: input.month_period
        };
        this.user = input.user;
        this.worker_collection = input.worker_collection;
    }

    private serialize(): Uint8Array {
        const inner = ClaimRewardsParamsCodec.encode(this.params);
        return Uint8Array.of(WorkerStakeInstruction.ClaimRewards, ...inner);
    }

    public async getInstruction() {
        const configPda = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(this.worker_collection);
        const userPositionPda = await UserStakePositionAccount.findUserStakePositionPDA(this.user, this.worker_collection);
        const monthlyPoolPda = await MonthlyPoolAccount.findMonthlyPoolPDA(this.worker_collection, this.params.month_period);
        
        const treasuryPda = await TreasuryAuthority.findWorkerStakeTreasuryPDA(this.worker_collection);

        // ATAs for treasuries
        const usdcTreasuryAta = await findAssociatedTokenPda({
            mint: USDC_MINT,
            owner: treasuryPda[0],
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });
        const bmbTreasuryAta = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: treasuryPda[0],
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        // ATAs for user's tokens
        const userUsdcAccount = await findAssociatedTokenPda({
            mint: USDC_MINT,
            owner: this.user,
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });
        const userBmbAccount = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: this.user,
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        const accounts = [
            { address: this.user, role: AccountRole.WRITABLE_SIGNER },
            { address: this.worker_collection, role: AccountRole.READONLY },
            { address: configPda[0], role: AccountRole.READONLY },
            { address: monthlyPoolPda[0], role: AccountRole.READONLY },
            { address: userPositionPda[0], role: AccountRole.WRITABLE },
            { address: treasuryPda[0], role: AccountRole.READONLY },
            { address: usdcTreasuryAta[0], role: AccountRole.WRITABLE },
            { address: userUsdcAccount[0], role: AccountRole.WRITABLE },
            { address: treasuryPda[0], role: AccountRole.READONLY },
            { address: bmbTreasuryAta[0], role: AccountRole.WRITABLE },
            { address: userBmbAccount[0], role: AccountRole.WRITABLE },
            { address: USDC_MINT, role: AccountRole.READONLY },
            { address: BMB_MINT, role: AccountRole.READONLY },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }
        ];

        return {
            programAddress: WORKER_STAKE_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
