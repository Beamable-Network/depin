import {
    AccountRole,
    address,
    Address,
    Codec,
    Endian,
    getAddressEncoder,
    getStructCodec,
    getU16Codec,
    getU64Codec,
    getProgramDerivedAddress
} from "gill";

import {
    BMB_MINT,
    BMB_TREASURY_SEED,
    SYSTEM_PROGRAM_ADDRESS,
    WORKER_STAKE_PROGRAM
} from "../../constants.js";
import { WorkerStakeInstruction } from "../../enums.js";
import { WorkerStakeConfigAccount } from "./worker-stake-config-account.js";
import { MonthlyPoolAccount } from "./monthly-pool-account.js";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

const addressEncoder = getAddressEncoder();

export interface DepositEmissionsParams {
    month_period: number;
    amount: bigint;
}

export const DepositEmissionsParamsCodec: Codec<DepositEmissionsParams> = getStructCodec([
    ["month_period", getU16Codec({ endian: Endian.Little })],
    ["amount", getU64Codec({ endian: Endian.Little })]
]);

export interface CreateDepositEmissionsInput {
    depositor: Address; // Authority that has BMB to deposit
    worker_collection: Address;
    month_period: number;
    amount: bigint;
    depositor_bmb_account: Address;
    worker_wallet_bmb_account: Address;
    has_monthly_pool: boolean; // Whether the month has a pool
    previous_pool_month_period?: number; // Optional, for inheritance
}

export class DepositEmissions {
    depositor: Address;
    worker_collection: Address;
    depositor_bmb_account: Address;
    worker_wallet_bmb_account: Address;
    has_monthly_pool: boolean;
    previous_pool_month_period?: number;
    readonly params: DepositEmissionsParams;

    constructor(input: CreateDepositEmissionsInput) {
        this.params = {
            month_period: input.month_period,
            amount: input.amount
        };
        this.depositor = input.depositor;
        this.worker_collection = input.worker_collection;
        this.depositor_bmb_account = input.depositor_bmb_account;
        this.worker_wallet_bmb_account = input.worker_wallet_bmb_account;
        this.has_monthly_pool = input.has_monthly_pool;
        this.previous_pool_month_period = input.previous_pool_month_period;
    }

    private serialize(): Uint8Array {
        const inner = DepositEmissionsParamsCodec.encode(this.params);
        return Uint8Array.of(WorkerStakeInstruction.DepositEmissions, ...inner);
    }

    public async getInstruction() {
        const configPda = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(this.worker_collection);

        // BMB treasury PDA
        const bmbTreasuryPda = await getProgramDerivedAddress({
            programAddress: WORKER_STAKE_PROGRAM,
            seeds: [BMB_TREASURY_SEED, addressEncoder.encode(this.worker_collection)]
        });

        // ATA for BMB treasury
        const bmbTreasuryAta = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: bmbTreasuryPda[0],
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        const accounts = [
            { address: this.depositor, role: AccountRole.WRITABLE_SIGNER },
            { address: this.worker_collection, role: AccountRole.READONLY },
            { address: configPda[0], role: AccountRole.READONLY },
            { address: this.depositor_bmb_account, role: AccountRole.WRITABLE },
            { address: this.worker_wallet_bmb_account, role: AccountRole.WRITABLE },
            { address: bmbTreasuryAta[0], role: AccountRole.WRITABLE },
            { address: bmbTreasuryPda[0], role: AccountRole.READONLY },
            { address: BMB_MINT, role: AccountRole.READONLY },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }
        ];

        // Add monthly pool if it exists
        if (this.has_monthly_pool) {
            const monthlyPoolPda = await MonthlyPoolAccount.findMonthlyPoolPDA(
                this.worker_collection,
                this.params.month_period
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
