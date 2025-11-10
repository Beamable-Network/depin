import {
    AccountRole,
    Address,
    Codec,
    Endian,
    getAddressEncoder,
    getStructCodec,
    getU64Codec
} from "gill";

import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { BMB_MINT, WORKER_STAKE_PROGRAM } from "../../constants.js";
import { WorkerStakeInstruction } from "../../enums.js";
import { WorkerStakeConfigAccount } from "./worker-stake-config-account.js";
import { WorkerStakeVault } from "./worker-stake-vault.js";

const addressEncoder = getAddressEncoder();

export interface WorkerUnstakeParams {
    amount: bigint;
}

export const WorkerUnstakeParamsCodec: Codec<WorkerUnstakeParams> = getStructCodec([
    ["amount", getU64Codec({ endian: Endian.Little })]
]);

export interface CreateWorkerUnstakeInput {
    collection_authority: Address;
    worker_collection: Address;
    amount: bigint;
}

export class WorkerUnstake {
    collection_authority: Address;
    worker_collection: Address;
    readonly params: WorkerUnstakeParams;

    constructor(input: CreateWorkerUnstakeInput) {
        this.params = {
            amount: input.amount
        };
        this.collection_authority = input.collection_authority;
        this.worker_collection = input.worker_collection;
    }

    private serialize(): Uint8Array {
        const inner = WorkerUnstakeParamsCodec.encode(this.params);
        return Uint8Array.of(WorkerStakeInstruction.WorkerUnstake, ...inner);
    }

    public async getInstruction() {
        const configPda = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(this.worker_collection);

        // Worker stake vault PDA
        const workerStakeVaultPda = await WorkerStakeVault.findWorkerStakeVaultPda(this.worker_collection);

        // ATA for worker stake vault
        const workerStakeVaultAta = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: workerStakeVaultPda[0],
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        // ATA for collection authority's BMB tokens
        const workerTokenAccount = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: this.collection_authority,
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        const accounts = [
            { address: this.collection_authority, role: AccountRole.READONLY_SIGNER },
            { address: this.worker_collection, role: AccountRole.READONLY },
            { address: configPda[0], role: AccountRole.WRITABLE },
            { address: workerStakeVaultPda[0], role: AccountRole.READONLY },
            { address: workerStakeVaultAta[0], role: AccountRole.WRITABLE },
            { address: workerTokenAccount[0], role: AccountRole.WRITABLE },
            { address: BMB_MINT, role: AccountRole.READONLY },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }
        ];

        return {
            programAddress: WORKER_STAKE_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
