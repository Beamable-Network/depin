import {
    AccountRole,
    address,
    Address,
    Codec,
    getArrayCodec,
    getStructCodec
} from "gill";

import { SYSTEM_PROGRAM_ADDRESS, WORKER_STAKE_PROGRAM } from "../../constants.js";
import { WorkerStakeInstruction } from "../../enums.js";
import { MonthlyPoolConfig, MonthlyPoolConfigCodec } from "./types/index.js";
import { WorkerStakeConfigAccount } from "./worker-stake-config-account.js";
import { MonthlyPoolAccount } from "./monthly-pool-account.js";

export interface SetMonthlyPoolParams {
    pools: MonthlyPoolConfig[];
}

export const SetMonthlyPoolParamsCodec: Codec<SetMonthlyPoolParams> = getStructCodec([
    ["pools", getArrayCodec(MonthlyPoolConfigCodec)]
]);

export interface CreateSetMonthlyPoolInput {
    collection_authority: Address;
    worker_collection: Address;
    pools: MonthlyPoolConfig[];
}

export class SetMonthlyPool {
    collection_authority: Address;
    worker_collection: Address;
    readonly params: SetMonthlyPoolParams;

    constructor(input: CreateSetMonthlyPoolInput) {
        this.params = {
            pools: input.pools
        };
        this.collection_authority = input.collection_authority;
        this.worker_collection = input.worker_collection;
    }

    private serialize(): Uint8Array {
        const inner = SetMonthlyPoolParamsCodec.encode(this.params);
        return Uint8Array.of(WorkerStakeInstruction.SetMonthlyPool, ...inner);
    }

    public async getInstruction() {
        const configPda = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(this.worker_collection);

        // Get PDAs for all monthly pools being set
        const monthlyPoolPdas = await Promise.all(
            this.params.pools.map(pool =>
                MonthlyPoolAccount.findMonthlyPoolPDA(this.worker_collection, pool.month_period)
            )
        );

        const accounts = [
            { address: this.collection_authority, role: AccountRole.WRITABLE_SIGNER },
            { address: this.worker_collection, role: AccountRole.READONLY },
            { address: configPda[0], role: AccountRole.WRITABLE },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            // Add all monthly pool PDAs as writable accounts
            ...monthlyPoolPdas.map(pda => ({
                address: pda[0],
                role: AccountRole.WRITABLE
            }))
        ];

        return {
            programAddress: WORKER_STAKE_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
