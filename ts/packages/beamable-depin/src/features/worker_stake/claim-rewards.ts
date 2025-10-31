import {
    AccountRole,
    Address,
    Codec,
    Endian,
    getAddressEncoder,
    getStructCodec,
    getU16Codec,
    getProgramDerivedAddress
} from "gill";

import {
    BMB_MINT,
    BMB_TREASURY_SEED,
    USDC_MINT,
    USDC_TREASURY_SEED,
    WORKER_STAKE_PROGRAM
} from "../../constants.js";
import { WorkerStakeInstruction } from "../../enums.js";
import { WorkerStakeConfigAccount } from "./worker-stake-config-account.js";
import { UserStakePositionAccount } from "./user-stake-position-account.js";
import { MonthlyPoolAccount } from "./monthly-pool-account.js";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";

const addressEncoder = getAddressEncoder();

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
    user_usdc_account: Address;
    user_bmb_account: Address;
}

export class ClaimRewards {
    user: Address;
    worker_collection: Address;
    user_usdc_account: Address;
    user_bmb_account: Address;
    readonly params: ClaimRewardsParams;

    constructor(input: CreateClaimRewardsInput) {
        this.params = {
            month_period: input.month_period
        };
        this.user = input.user;
        this.worker_collection = input.worker_collection;
        this.user_usdc_account = input.user_usdc_account;
        this.user_bmb_account = input.user_bmb_account;
    }

    private serialize(): Uint8Array {
        const inner = ClaimRewardsParamsCodec.encode(this.params);
        return Uint8Array.of(WorkerStakeInstruction.ClaimRewards, ...inner);
    }

    public async getInstruction() {
        const configPda = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(this.worker_collection);
        const userPositionPda = await UserStakePositionAccount.findUserStakePositionPDA(this.user, this.worker_collection);
        const monthlyPoolPda = await MonthlyPoolAccount.findMonthlyPoolPDA(this.worker_collection, this.params.month_period);

        // USDC treasury PDA
        const usdcTreasuryPda = await getProgramDerivedAddress({
            programAddress: WORKER_STAKE_PROGRAM,
            seeds: [USDC_TREASURY_SEED, addressEncoder.encode(this.worker_collection)]
        });

        // BMB treasury PDA
        const bmbTreasuryPda = await getProgramDerivedAddress({
            programAddress: WORKER_STAKE_PROGRAM,
            seeds: [BMB_TREASURY_SEED, addressEncoder.encode(this.worker_collection)]
        });

        // ATAs for treasuries
        const usdcTreasuryAta = await findAssociatedTokenPda({
            mint: USDC_MINT,
            owner: usdcTreasuryPda[0],
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });
        const bmbTreasuryAta = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: bmbTreasuryPda[0],
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        const accounts = [
            { address: this.user, role: AccountRole.WRITABLE_SIGNER },
            { address: this.worker_collection, role: AccountRole.READONLY },
            { address: configPda[0], role: AccountRole.READONLY },
            { address: monthlyPoolPda[0], role: AccountRole.READONLY },
            { address: userPositionPda[0], role: AccountRole.WRITABLE },
            { address: usdcTreasuryPda[0], role: AccountRole.READONLY },
            { address: usdcTreasuryAta[0], role: AccountRole.WRITABLE },
            { address: this.user_usdc_account, role: AccountRole.WRITABLE },
            { address: bmbTreasuryPda[0], role: AccountRole.READONLY },
            { address: bmbTreasuryAta[0], role: AccountRole.WRITABLE },
            { address: this.user_bmb_account, role: AccountRole.WRITABLE },
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
