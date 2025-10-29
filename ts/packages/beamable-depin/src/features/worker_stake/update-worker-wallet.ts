import {
    AccountRole,
    Address,
    Codec,
    getAddressCodec,
    getStructCodec
} from "gill";

import { WORKER_STAKE_PROGRAM } from "../../constants.js";
import { WorkerStakeInstruction } from "../../enums.js";
import { WorkerStakeConfigAccount } from "./worker-stake-config-account.js";

export interface UpdateWorkerWalletParams {
    new_worker_wallet: Address;
}

export const UpdateWorkerWalletParamsCodec: Codec<UpdateWorkerWalletParams> = getStructCodec([
    ["new_worker_wallet", getAddressCodec()]
]);

export interface CreateUpdateWorkerWalletInput {
    collection_authority: Address;
    worker_collection: Address;
    new_worker_wallet: Address;
}

export class UpdateWorkerWallet {
    collection_authority: Address;
    worker_collection: Address;
    readonly params: UpdateWorkerWalletParams;

    constructor(input: CreateUpdateWorkerWalletInput) {
        this.params = {
            new_worker_wallet: input.new_worker_wallet
        };
        this.collection_authority = input.collection_authority;
        this.worker_collection = input.worker_collection;
    }

    private serialize(): Uint8Array {
        const inner = UpdateWorkerWalletParamsCodec.encode(this.params);
        return Uint8Array.of(WorkerStakeInstruction.UpdateWorkerWallet, ...inner);
    }

    public async getInstruction() {
        const configPda = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(this.worker_collection);

        const accounts = [
            { address: this.collection_authority, role: AccountRole.READONLY_SIGNER },
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
