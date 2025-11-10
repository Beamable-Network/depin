import {
    AccountRole,
    Address,
    Codec,
    Endian,
    getAddressCodec,
    getAddressEncoder,
    getStructCodec,
    getU64Codec
} from "gill";

import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
    SYSTEM_PROGRAM_ADDRESS,
    USDC_MINT,
    WORKER_STAKE_PROGRAM
} from "../../constants.js";
import { WorkerStakeInstruction } from "../../enums.js";
import { TreasuryAuthority } from "../treasury/treasury-authority.js";
import { MonthlyPoolAccount } from "./monthly-pool-account.js";
import { WorkerStakeConfigAccount } from "./worker-stake-config-account.js";

export interface DepositRevenueParams {
    worker_collection: Address;
    total_revenue: bigint;
}

export const DepositRevenueParamsCodec: Codec<DepositRevenueParams> = getStructCodec([
    ["worker_collection", getAddressCodec()],
    ["total_revenue", getU64Codec({ endian: Endian.Little })]
]);

export interface CreateDepositRevenueInput {
    revenue_source: Address; // Authority that has USDC to deposit
    worker_collection: Address;
    worker_wallet: Address; // Worker wallet address (for ATA creation)
    total_revenue: bigint;
    current_month_period: number;
    has_monthly_pool: boolean; // Whether current month has a pool
    previous_pool_month_period?: number; // Optional, for inheritance
}

export class DepositRevenue {
    revenue_source: Address;
    worker_collection: Address;
    worker_wallet: Address;
    current_month_period: number;
    has_monthly_pool: boolean;
    previous_pool_month_period?: number;
    readonly params: DepositRevenueParams;

    constructor(input: CreateDepositRevenueInput) {
        this.params = {
            worker_collection: input.worker_collection,
            total_revenue: input.total_revenue
        };
        this.revenue_source = input.revenue_source;
        this.worker_collection = input.worker_collection;
        this.worker_wallet = input.worker_wallet;
        this.current_month_period = input.current_month_period;
        this.has_monthly_pool = input.has_monthly_pool;
        this.previous_pool_month_period = input.previous_pool_month_period;
    }

    private serialize(): Uint8Array {
        const inner = DepositRevenueParamsCodec.encode(this.params);
        return Uint8Array.of(WorkerStakeInstruction.DepositRevenue, ...inner);
    }

    public async getInstruction() {
        const configPda = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(this.worker_collection);

        // USDC treasury PDA
        const treasuryPda = await TreasuryAuthority.finWorkerStakeTreasuryPDA(this.worker_collection);

        // ATA for USDC treasury
        const usdcTreasuryAta = await findAssociatedTokenPda({
            mint: USDC_MINT,
            owner: treasuryPda[0],
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        // ATAs for revenue source and worker wallet
        const revenueSourceUsdcAccount = await findAssociatedTokenPda({
            mint: USDC_MINT,
            owner: this.revenue_source,
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });
        const workerWalletUsdcAccount = await findAssociatedTokenPda({
            mint: USDC_MINT,
            owner: this.worker_wallet,
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        const accounts = [
            { address: this.revenue_source, role: AccountRole.WRITABLE_SIGNER },
            { address: configPda[0], role: AccountRole.WRITABLE },
            { address: revenueSourceUsdcAccount[0], role: AccountRole.WRITABLE },
            { address: treasuryPda[0], role: AccountRole.READONLY },
            { address: usdcTreasuryAta[0], role: AccountRole.WRITABLE },
            { address: this.worker_wallet, role: AccountRole.WRITABLE },
            { address: workerWalletUsdcAccount[0], role: AccountRole.WRITABLE },
            { address: USDC_MINT, role: AccountRole.READONLY },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }
        ];

        // Add monthly pool if it exists
        if (this.has_monthly_pool) {
            const monthlyPoolPda = await MonthlyPoolAccount.findMonthlyPoolPDA(
                this.worker_collection,
                this.current_month_period
            );
            accounts.push({ address: monthlyPoolPda[0], role: AccountRole.WRITABLE });

            // Add previous pool if provided (for inheritance)
            if (this.previous_pool_month_period !== undefined) {
                const previousPoolPda = await MonthlyPoolAccount.findMonthlyPoolPDA(
                    this.worker_collection,
                    this.previous_pool_month_period
                );
                accounts.push({ address: previousPoolPda[0], role: AccountRole.READONLY });
            }
        }

        return {
            programAddress: WORKER_STAKE_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
