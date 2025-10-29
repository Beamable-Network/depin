import {
    AccountRole,
    address,
    Address,
    Codec,
    Endian,
    getAddressEncoder,
    getStructCodec,
    getU64Codec,
    getProgramDerivedAddress
} from "gill";

import {
    SYSTEM_PROGRAM_ADDRESS,
    USDC_MINT,
    USDC_TREASURY_SEED,
    WORKER_STAKE_PROGRAM
} from "../../constants.js";
import { WorkerStakeInstruction } from "../../enums.js";
import { WorkerStakeConfigAccount } from "./worker-stake-config-account.js";
import { MonthlyPoolAccount } from "./monthly-pool-account.js";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

const addressEncoder = getAddressEncoder();

export interface DepositRevenueParams {
    total_revenue: bigint;
}

export const DepositRevenueParamsCodec: Codec<DepositRevenueParams> = getStructCodec([
    ["total_revenue", getU64Codec({ endian: Endian.Little })]
]);

export interface CreateDepositRevenueInput {
    revenue_source: Address; // Authority that has USDC to deposit
    worker_collection: Address;
    total_revenue: bigint;
    current_month_period: number;
    revenue_source_usdc_account: Address;
    worker_wallet_usdc_account: Address;
    has_monthly_pool: boolean; // Whether current month has a pool
    previous_pool_month_period?: number; // Optional, for inheritance
}

export class DepositRevenue {
    revenue_source: Address;
    worker_collection: Address;
    revenue_source_usdc_account: Address;
    worker_wallet_usdc_account: Address;
    current_month_period: number;
    has_monthly_pool: boolean;
    previous_pool_month_period?: number;
    readonly params: DepositRevenueParams;

    constructor(input: CreateDepositRevenueInput) {
        this.params = {
            total_revenue: input.total_revenue
        };
        this.revenue_source = input.revenue_source;
        this.worker_collection = input.worker_collection;
        this.revenue_source_usdc_account = input.revenue_source_usdc_account;
        this.worker_wallet_usdc_account = input.worker_wallet_usdc_account;
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
        const usdcTreasuryPda = await getProgramDerivedAddress({
            programAddress: WORKER_STAKE_PROGRAM,
            seeds: [USDC_TREASURY_SEED, addressEncoder.encode(this.worker_collection)]
        });

        // ATA for USDC treasury
        const usdcTreasuryAta = await findAssociatedTokenPda({
            mint: USDC_MINT,
            owner: usdcTreasuryPda[0],
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        const accounts = [
            { address: this.revenue_source, role: AccountRole.WRITABLE_SIGNER },
            { address: this.worker_collection, role: AccountRole.READONLY },
            { address: configPda[0], role: AccountRole.WRITABLE },
            { address: this.revenue_source_usdc_account, role: AccountRole.WRITABLE },
            { address: this.worker_wallet_usdc_account, role: AccountRole.WRITABLE },
            { address: usdcTreasuryAta[0], role: AccountRole.WRITABLE },
            { address: usdcTreasuryPda[0], role: AccountRole.READONLY },
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
