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

import { AssetWithProof } from "@metaplex-foundation/mpl-bubblegum";
import { BMB_MINT, COMMUNITY_STAKE_VAULT_SEED, SYSTEM_PROGRAM_ADDRESS, WORKER_STAKE_PROGRAM, MPL_ACCOUNT_COMPRESSION_PROGRAM } from "../../constants.js";
import { assetToCNftContext, CNftContext, CNftContextCodec } from "../../utils/bubblegum.js";
import { WorkerStakeInstruction } from "../../enums.js";
import { WorkerStakeConfigAccount } from "./worker-stake-config-account.js";
import { UserStakePositionAccount } from "./user-stake-position-account.js";
import { MonthlyPoolAccount } from "./monthly-pool-account.js";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

const addressEncoder = getAddressEncoder();

export interface StakeParams {
    amount: bigint;
    checker_count: number;
    license_context: CNftContext;
}

export const StakeParamsCodec: Codec<StakeParams> = getStructCodec([
    ["amount", getU64Codec({ endian: Endian.Little })],
    ["checker_count", getU16Codec({ endian: Endian.Little })],
    ["license_context", CNftContextCodec]
]);

export interface CreateStakeInput {
    user: Address;
    worker: Address;
    worker_license: AssetWithProof;
    worker_collection: Address;
    amount: bigint;
    checker_count: number;
    current_month_period: number;
    previous_pool_month_period?: number; // Optional, only needed if last_active_pool_month > 0
}

export class Stake {
    user: Address;
    worker: Address;
    worker_license: AssetWithProof;
    worker_collection: Address;
    current_month_period: number;
    previous_pool_month_period?: number;
    readonly params: StakeParams;

    constructor(input: CreateStakeInput) {
        this.params = {
            amount: input.amount,
            checker_count: input.checker_count,
            license_context: assetToCNftContext(input.worker_license)
        };
        this.user = input.user;
        this.worker = input.worker;
        this.worker_license = input.worker_license;
        this.worker_collection = input.worker_collection;
        this.current_month_period = input.current_month_period;
        this.previous_pool_month_period = input.previous_pool_month_period;
    }

    private serialize(): Uint8Array {
        const inner = StakeParamsCodec.encode(this.params);
        return Uint8Array.of(WorkerStakeInstruction.Stake, ...inner);
    }

    public async getInstruction() {
        const configPda = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(this.worker_collection);
        const userPositionPda = await UserStakePositionAccount.findUserStakePositionPDA(this.user, this.worker_collection);
        const currentPoolPda = await MonthlyPoolAccount.findMonthlyPoolPDA(this.worker_collection, this.current_month_period);

        // Community stake vault PDA
        const communityStakeVaultPda = await getProgramDerivedAddress({
            programAddress: WORKER_STAKE_PROGRAM,
            seeds: [COMMUNITY_STAKE_VAULT_SEED, addressEncoder.encode(this.worker_collection)]
        });

        // ATA for community stake vault
        const communityStakeVaultAta = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: communityStakeVaultPda[0],
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        // ATA for user's BMB tokens
        const userTokenAccount = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: this.user,
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        const accounts = [
            { address: this.user, role: AccountRole.WRITABLE_SIGNER },
            { address: this.worker, role: AccountRole.READONLY_SIGNER },
            { address: this.worker_collection, role: AccountRole.READONLY },
            { address: configPda[0], role: AccountRole.WRITABLE },
            { address: currentPoolPda[0], role: AccountRole.WRITABLE },
            { address: userPositionPda[0], role: AccountRole.WRITABLE },
            { address: userTokenAccount[0], role: AccountRole.WRITABLE },
            { address: communityStakeVaultPda[0], role: AccountRole.READONLY },
            { address: communityStakeVaultAta[0], role: AccountRole.WRITABLE },
            { address: BMB_MINT, role: AccountRole.READONLY },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: MPL_ACCOUNT_COMPRESSION_PROGRAM, role: AccountRole.READONLY },
            { address: address(this.worker_license.merkleTree), role: AccountRole.READONLY }
        ];

        // Add previous pool account (required as account #15, use system program if not needed)
        if (this.previous_pool_month_period !== undefined) {
            const previousPoolPda = await MonthlyPoolAccount.findMonthlyPoolPDA(
                this.worker_collection,
                this.previous_pool_month_period
            );
            accounts.push({ address: previousPoolPda[0], role: AccountRole.WRITABLE });
        } else {
            accounts.push({ address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY });
        }

        // Add proof accounts for Merkle tree verification
        const proofAccounts = this.worker_license.proof.map(proof => ({
            address: address(proof),
            role: AccountRole.READONLY
        }));
        accounts.push(...proofAccounts);

        return {
            programAddress: WORKER_STAKE_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
