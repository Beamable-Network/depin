import {
    AccountRole,
    addCodecSizePrefix,
    address,
    Address,
    Codec,
    getStructCodec,
    getU32Codec,
    getUtf8Codec
} from "gill";

import { AssetWithProof } from "@metaplex-foundation/mpl-bubblegum";
import { DEPIN_PROGRAM, MPL_ACCOUNT_COMPRESSION_PROGRAM, SYSTEM_PROGRAM_ADDRESS } from "../../constants.js";
import { DepinInstruction } from "../../enums.js";
import { assetToCNftContext, CNftContext, CNftContextCodec } from "../../utils/bubblegum.js";
import { WorkerMetadataAccount } from "./worker-metadata-account.js";

export interface UpdateWorkerUriParams {
    license_context: CNftContext;
    discovery_uri: string;
}

export const UpdateWorkerUriParamsCodec: Codec<UpdateWorkerUriParams> = getStructCodec([
    ["license_context", CNftContextCodec],
    ["discovery_uri", addCodecSizePrefix(getUtf8Codec(), getU32Codec())],
]);

export interface CreateUpdateWorkerUriInput {
    signer: Address;
    worker_license: AssetWithProof;
    discovery_uri: string;
}

export class UpdateWorkerUri {
    signer: Address;
    readonly worker_license: AssetWithProof;
    readonly params: UpdateWorkerUriParams;

    constructor(input: CreateUpdateWorkerUriInput) {
        this.params = {
            license_context: assetToCNftContext(input.worker_license),
            discovery_uri: input.discovery_uri,
        };

        this.worker_license = input.worker_license;
        this.signer = input.signer;
    }

    private serialize(): Uint8Array {
        const inner = UpdateWorkerUriParamsCodec.encode(this.params);
        return Uint8Array.of(DepinInstruction.UpdateWorkerUri, ...inner);
    }

    public async getInstruction() {
        const workerMetadataPda = await WorkerMetadataAccount.findWorkerMetadataPDA(
            address(this.worker_license.rpcAsset.id),
            address(this.params.license_context.owner)
        );

        let accounts = [
            { address: this.signer, role: AccountRole.READONLY_SIGNER },
            { address: workerMetadataPda[0], role: AccountRole.WRITABLE },
            { address: MPL_ACCOUNT_COMPRESSION_PROGRAM, role: AccountRole.READONLY },
            { address: address(this.worker_license.merkleTree), role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ...this.worker_license.proof.map(proof => ({
                address: address(proof),
                role: AccountRole.READONLY
            }))
        ];

        return {
            programAddress: DEPIN_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}