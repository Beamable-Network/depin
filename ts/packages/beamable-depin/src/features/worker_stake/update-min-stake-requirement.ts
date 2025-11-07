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

import { WORKER_STAKE_PROGRAM } from "../../constants.js";
import { WorkerStakeInstruction } from "../../enums.js";
import { getProgramDataAddress } from "../../utils/bpf.js";
import { WorkerStakeConfigAccount } from "./worker-stake-config-account.js";

export interface UpdateMinStakeRequirementParams {
    worker_collection: Address;
    new_min_stake_requirement: bigint;
}

export const UpdateMinStakeRequirementParamsCodec: Codec<UpdateMinStakeRequirementParams> = getStructCodec([
    ["worker_collection", getAddressCodec()],
    ["new_min_stake_requirement", getU64Codec({ endian: Endian.Little })]
]);

export interface CreateUpdateMinStakeRequirementInput {
    upgrade_authority: Address;
    worker_collection: Address;
    new_min_stake_requirement: bigint;
}

export class UpdateMinStakeRequirement {
    upgrade_authority: Address;
    worker_collection: Address;
    readonly params: UpdateMinStakeRequirementParams;

    constructor(input: CreateUpdateMinStakeRequirementInput) {
        this.params = {
            worker_collection: input.worker_collection,
            new_min_stake_requirement: input.new_min_stake_requirement
        };
        this.upgrade_authority = input.upgrade_authority;
        this.worker_collection = input.worker_collection;
    }

    private serialize(): Uint8Array {
        const inner = UpdateMinStakeRequirementParamsCodec.encode(this.params);
        return Uint8Array.of(WorkerStakeInstruction.UpdateMinStakeRequirement, ...inner);
    }

    public async getInstruction() {
        const configPda = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(this.worker_collection);

        // Calculate ProgramData PDA for upgrade authority verification
        const programDataAddress = await getProgramDataAddress(WORKER_STAKE_PROGRAM);

        const accounts = [
            { address: this.upgrade_authority, role: AccountRole.READONLY_SIGNER },
            { address: programDataAddress, role: AccountRole.READONLY },
            { address: configPda[0], role: AccountRole.WRITABLE }
        ];

        return {
            programAddress: WORKER_STAKE_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
