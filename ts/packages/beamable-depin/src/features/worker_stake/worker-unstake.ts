import {
    AccountRole,
    Address,
    Codec,
    Endian,
    getAddressEncoder,
    getStructCodec,
    getU64Codec,
    getProgramDerivedAddress
} from "gill";

import { BMB_MINT, WORKER_STAKE_PROGRAM, WORKER_STAKE_VAULT_SEED } from "../../constants.js";
import { WorkerStakeInstruction } from "../../enums.js";
import { WorkerStakeConfigAccount } from "./worker-stake-config-account.js";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

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
    worker_token_account: Address;
}

export class WorkerUnstake {
    collection_authority: Address;
    worker_collection: Address;
    worker_token_account: Address;
    readonly params: WorkerUnstakeParams;

    constructor(input: CreateWorkerUnstakeInput) {
        this.params = {
            amount: input.amount
        };
        this.collection_authority = input.collection_authority;
        this.worker_collection = input.worker_collection;
        this.worker_token_account = input.worker_token_account;
    }

    private serialize(): Uint8Array {
        const inner = WorkerUnstakeParamsCodec.encode(this.params);
        return Uint8Array.of(WorkerStakeInstruction.WorkerUnstake, ...inner);
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

        const accounts = [
            { address: this.collection_authority, role: AccountRole.READONLY_SIGNER },
            { address: this.worker_collection, role: AccountRole.READONLY },
            { address: configPda[0], role: AccountRole.WRITABLE },
            { address: workerStakeVaultAta[0], role: AccountRole.WRITABLE },
            { address: this.worker_token_account, role: AccountRole.WRITABLE },
            { address: workerStakeVaultPda[0], role: AccountRole.READONLY },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }
        ];

        return {
            programAddress: WORKER_STAKE_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
