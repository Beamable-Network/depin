import {
    AccountRole,
    Address,
    Codec,
    Endian,
    getStructCodec,
    getU64Codec
} from "gill";

import { WORKER_STAKE_PROGRAM } from "../../constants.js";
import { WorkerStakeInstruction } from "../../enums.js";
import { WorkerStakeConfigAccount } from "./worker-stake-config-account.js";

export interface UpdateMinStakeRequirementParams {
    new_min_stake_requirement: bigint;
}

export const UpdateMinStakeRequirementParamsCodec: Codec<UpdateMinStakeRequirementParams> = getStructCodec([
    ["new_min_stake_requirement", getU64Codec({ endian: Endian.Little })]
]);

export interface CreateUpdateMinStakeRequirementInput {
    collection_authority: Address;
    network_admin: Address;
    worker_collection: Address;
    new_min_stake_requirement: bigint;
}

export class UpdateMinStakeRequirement {
    collection_authority: Address;
    network_admin: Address;
    worker_collection: Address;
    readonly params: UpdateMinStakeRequirementParams;

    constructor(input: CreateUpdateMinStakeRequirementInput) {
        this.params = {
            new_min_stake_requirement: input.new_min_stake_requirement
        };
        this.collection_authority = input.collection_authority;
        this.network_admin = input.network_admin;
        this.worker_collection = input.worker_collection;
    }

    private serialize(): Uint8Array {
        const inner = UpdateMinStakeRequirementParamsCodec.encode(this.params);
        return Uint8Array.of(WorkerStakeInstruction.UpdateMinStakeRequirement, ...inner);
    }

    public async getInstruction() {
        const configPda = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(this.worker_collection);

        const accounts = [
            { address: this.collection_authority, role: AccountRole.READONLY_SIGNER },
            { address: this.network_admin, role: AccountRole.READONLY_SIGNER },
            { address: this.worker_collection, role: AccountRole.READONLY },
            { address: configPda[0], role: AccountRole.WRITABLE }
        ];

        return {
            programAddress: WORKER_STAKE_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
