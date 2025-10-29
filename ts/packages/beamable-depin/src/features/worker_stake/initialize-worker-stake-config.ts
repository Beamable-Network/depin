import {
    AccountRole,
    address,
    Address,
    Codec,
    Endian,
    getAddressCodec,
    getStructCodec,
    getU64Codec
} from "gill";

import { SYSTEM_PROGRAM_ADDRESS, WORKER_STAKE_PROGRAM } from "../../constants.js";
import { WorkerStakeInstruction } from "../../enums.js";
import { WorkerStakeConfigAccount } from "./worker-stake-config-account.js";

export interface InitializeWorkerStakeConfigParams {
    worker_collection: Address;
    worker_wallet: Address;
    min_stake_requirement: bigint;
}

export const InitializeWorkerStakeConfigParamsCodec: Codec<InitializeWorkerStakeConfigParams> = getStructCodec([
    ["worker_collection", getAddressCodec()],
    ["worker_wallet", getAddressCodec()],
    ["min_stake_requirement", getU64Codec({ endian: Endian.Little })]
]);

export interface CreateInitializeWorkerStakeConfigInput {
    collection_authority: Address;
    network_admin: Address;
    worker_collection: Address;
    worker_wallet: Address;
    min_stake_requirement: bigint;
}

export class InitializeWorkerStakeConfig {
    collection_authority: Address;
    network_admin: Address;
    readonly params: InitializeWorkerStakeConfigParams;

    constructor(input: CreateInitializeWorkerStakeConfigInput) {
        this.params = {
            worker_collection: input.worker_collection,
            worker_wallet: input.worker_wallet,
            min_stake_requirement: input.min_stake_requirement
        };
        this.collection_authority = input.collection_authority;
        this.network_admin = input.network_admin;
    }

    private serialize(): Uint8Array {
        const inner = InitializeWorkerStakeConfigParamsCodec.encode(this.params);
        return Uint8Array.of(WorkerStakeInstruction.InitializeWorkerStakeConfig, ...inner);
    }

    public async getInstruction() {
        const configPda = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(this.params.worker_collection);

        const accounts = [
            { address: this.collection_authority, role: AccountRole.WRITABLE_SIGNER },
            { address: this.network_admin, role: AccountRole.READONLY_SIGNER },
            { address: this.params.worker_collection, role: AccountRole.READONLY },
            { address: configPda[0], role: AccountRole.WRITABLE },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }
        ];

        return {
            programAddress: WORKER_STAKE_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
