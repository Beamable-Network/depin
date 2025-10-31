import {
    AccountRole,
    address,
    Address,
    getAddressEncoder,
    getProgramDerivedAddress
} from "gill";

import { BMB_MINT, COMMUNITY_STAKE_VAULT_SEED, WORKER_STAKE_PROGRAM } from "../../constants.js";
import { WorkerStakeInstruction } from "../../enums.js";
import { WorkerStakeConfigAccount } from "./worker-stake-config-account.js";
import { UserStakePositionAccount } from "./user-stake-position-account.js";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

const addressEncoder = getAddressEncoder();

export interface CreateWithdrawInput {
    user: Address;
    worker_collection: Address;
    user_token_account: Address;
}

export class Withdraw {
    user: Address;
    worker_collection: Address;
    user_token_account: Address;

    constructor(input: CreateWithdrawInput) {
        this.user = input.user;
        this.worker_collection = input.worker_collection;
        this.user_token_account = input.user_token_account;
    }

    private serialize(): Uint8Array {
        // Withdraw has no parameters, just the discriminator
        return Uint8Array.of(WorkerStakeInstruction.Withdraw);
    }

    public async getInstruction() {
        const configPda = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(this.worker_collection);
        const userPositionPda = await UserStakePositionAccount.findUserStakePositionPDA(this.user, this.worker_collection);

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

        const accounts = [
            { address: this.user, role: AccountRole.WRITABLE_SIGNER },
            { address: this.worker_collection, role: AccountRole.READONLY },
            { address: configPda[0], role: AccountRole.WRITABLE },
            { address: userPositionPda[0], role: AccountRole.WRITABLE },
            { address: communityStakeVaultPda[0], role: AccountRole.READONLY },
            { address: communityStakeVaultAta[0], role: AccountRole.WRITABLE },
            { address: this.user_token_account, role: AccountRole.WRITABLE },
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
