import {
    AccountRole,
    address,
    Address,
    getProgramDerivedAddress
} from "gill";

import { WORKER_STAKE_PROGRAM } from "../../constants.js";
import { WorkerStakeInstruction } from "../../enums.js";
import { WorkerStakeConfigAccount } from "./worker-stake-config-account.js";
import { UserStakePositionAccount } from "./user-stake-position-account.js";
import { MonthlyPoolAccount } from "./monthly-pool-account.js";

export interface CreateUnstakeInput {
    user: Address;
    worker_collection: Address;
    last_active_pool_month_period: number; // From WorkerStakeConfig.last_active_pool_month
}

export class Unstake {
    user: Address;
    worker_collection: Address;
    last_active_pool_month_period: number;

    constructor(input: CreateUnstakeInput) {
        this.user = input.user;
        this.worker_collection = input.worker_collection;
        this.last_active_pool_month_period = input.last_active_pool_month_period;
    }

    private serialize(): Uint8Array {
        // Unstake has no parameters, just the discriminator
        return Uint8Array.of(WorkerStakeInstruction.Unstake);
    }

    public async getInstruction() {
        const configPda = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(this.worker_collection);
        const userPositionPda = await UserStakePositionAccount.findUserStakePositionPDA(this.user, this.worker_collection);

        const accounts = [
            { address: this.user, role: AccountRole.READONLY_SIGNER },
            { address: this.worker_collection, role: AccountRole.READONLY },
            { address: configPda[0], role: AccountRole.READONLY },
            { address: userPositionPda[0], role: AccountRole.WRITABLE }
        ];

        // Add last active pool if it exists (last_active_pool_month > 0)
        if (this.last_active_pool_month_period > 0) {
            const lastActivePoolPda = await MonthlyPoolAccount.findMonthlyPoolPDA(
                this.worker_collection,
                this.last_active_pool_month_period
            );
            accounts.push({ address: lastActivePoolPda[0], role: AccountRole.WRITABLE });
        }

        return {
            programAddress: WORKER_STAKE_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
