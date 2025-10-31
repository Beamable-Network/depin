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

import { BMB_MINT, SYSTEM_PROGRAM_ADDRESS, WORKER_STAKE_PROGRAM, WORKER_STAKE_VAULT_SEED } from "../../constants.js";
import { WorkerStakeInstruction } from "../../enums.js";
import { WorkerStakeConfigAccount } from "./worker-stake-config-account.js";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

const addressEncoder = getAddressEncoder();

export interface WorkerStakeParams {
    amount: bigint;
}

export const WorkerStakeParamsCodec: Codec<WorkerStakeParams> = getStructCodec([
    ["amount", getU64Codec({ endian: Endian.Little })]
]);

export interface CreateWorkerStakeInput {
    collection_authority: Address;
    worker_collection: Address;
    amount: bigint;
}

export class WorkerStake {
    collection_authority: Address;
    worker_collection: Address;
    readonly params: WorkerStakeParams;

    constructor(input: CreateWorkerStakeInput) {
        this.params = {
            amount: input.amount
        };
        this.collection_authority = input.collection_authority;
        this.worker_collection = input.worker_collection;
    }

    private serialize(): Uint8Array {
        const inner = WorkerStakeParamsCodec.encode(this.params);
        return Uint8Array.of(WorkerStakeInstruction.WorkerStake, ...inner);
    }

    public async getInstruction() {
        const configPda = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(this.worker_collection);

        // Worker stake vault PDA
        const workerStakeVaultPda = await getProgramDerivedAddress({
            programAddress: WORKER_STAKE_PROGRAM,
            seeds: [WORKER_STAKE_VAULT_SEED, addressEncoder.encode(this.worker_collection)]
        });

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
            { address: this.collection_authority, role: AccountRole.WRITABLE_SIGNER },
            { address: this.worker_collection, role: AccountRole.READONLY },
            { address: configPda[0], role: AccountRole.WRITABLE },
            { address: workerTokenAccount[0], role: AccountRole.WRITABLE },
            { address: workerStakeVaultPda[0], role: AccountRole.READONLY },
            { address: workerStakeVaultAta[0], role: AccountRole.WRITABLE },
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
