import {
    AccountRole,
    Address,
    getAddressEncoder,
    getProgramDerivedAddress
} from "gill";

import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { BMB_MINT, COMMUNITY_STAKE_VAULT_SEED, WORKER_STAKE_PROGRAM } from "../../constants.js";
import { WorkerStakeInstruction } from "../../enums.js";
import { UserStakePositionAccount } from "./user-stake-position-account.js";
import { WorkerStakeConfigAccount } from "./worker-stake-config-account.js";

const addressEncoder = getAddressEncoder();

export interface CreateWithdrawInput {
    user: Address;
    worker_wallet: Address;
    worker_collection: Address;
}

export class Withdraw {
    user: Address;
    worker_wallet: Address;
    worker_collection: Address;

    constructor(input: CreateWithdrawInput) {
        this.user = input.user;
        this.worker_wallet = input.worker_wallet;
        this.worker_collection = input.worker_collection;
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

        // ATA for user's BMB tokens
        const userTokenAccount = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: this.user,
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        const accounts = [
            { address: this.user, role: AccountRole.READONLY_SIGNER },
            { address: this.worker_wallet, role: AccountRole.WRITABLE },
            { address: this.worker_collection, role: AccountRole.READONLY },
            { address: configPda[0], role: AccountRole.WRITABLE },
            { address: userPositionPda[0], role: AccountRole.WRITABLE },
            { address: communityStakeVaultPda[0], role: AccountRole.READONLY },
            { address: communityStakeVaultAta[0], role: AccountRole.WRITABLE },
            { address: userTokenAccount[0], role: AccountRole.WRITABLE },
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
