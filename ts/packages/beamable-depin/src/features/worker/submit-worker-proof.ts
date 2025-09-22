import {
    AccountRole,
    address,
    Codec,
    getBytesCodec,
    getStructCodec,
    getU16Codec,
    getU32Codec,
    ReadonlyUint8Array,
    type TransactionSigner,
} from "gill";

import { AssetWithProof } from "@metaplex-foundation/mpl-bubblegum";
import { DEPIN_PROGRAM, MPL_ACCOUNT_COMPRESSION_PROGRAM, SYSTEM_PROGRAM_ADDRESS } from "../../constants.js";
import { DepinInstruction } from "../../enums.js";
import { assetToCNftContext, CNftContext, CNftContextCodec } from "../../utils/bubblegum.js";
import { GlobalRewardsAccount } from "../global/global-rewards-account.js";
import { findWorkerProofPDA } from "./worker-proof-account.js";
import { BMBStateAccount } from "../global/bmb-state-account.js";
import { findWorkerLicenseMetadataPDA } from "./worker-license-metadata-account.js";
import { WorkerMetadataAccount } from "./worker-metadata-account.js";

export interface SubmitWorkerProofParams {
    license_context: CNftContext;
    proof_root: ReadonlyUint8Array;
    period: number;
    checkers: ReadonlyUint8Array;
    uptime: number;
    latency: number;
}

export const SubmitWorkerProofParamsCodec: Codec<SubmitWorkerProofParams> = getStructCodec([
    ["license_context", CNftContextCodec],
    ["proof_root", getBytesCodec()],
    ["period", getU16Codec()],
    ["checkers", getBytesCodec()],
    ["uptime", getU32Codec()],
    ["latency", getU32Codec()],
]);

export interface CreateSubmitWorkerProofInput {
    payer: TransactionSigner;
    worker_license: AssetWithProof;
    proof_root: ReadonlyUint8Array;
    period: number;
    checkers: ReadonlyUint8Array;
    uptime: number;
    latency: number;
}

export class SubmitWorkerProof {
    payer: TransactionSigner;
    readonly worker_license: AssetWithProof;
    readonly params: SubmitWorkerProofParams;
    
    constructor(input: CreateSubmitWorkerProofInput) {
        this.params = {
            license_context: assetToCNftContext(input.worker_license),
            proof_root: input.proof_root,
            period: input.period,
            checkers: input.checkers,
            uptime: input.uptime,
            latency: input.latency,
        };

        this.worker_license = input.worker_license;
        this.payer = input.payer;
    }

    private serialize(): Uint8Array {
        const inner = SubmitWorkerProofParamsCodec.encode(this.params);
        return Uint8Array.of(DepinInstruction.SubmitWorkerProof, ...inner);
    }

    public async getInstruction() {
        const globalRewardsPda = await GlobalRewardsAccount.findGlobalRewardsPDA();
        let proofPda = await findWorkerProofPDA(address(this.worker_license.rpcAsset.id), this.params.period);
        let workerMetadataPda = await WorkerMetadataAccount.findWorkerMetadataPDA(address(this.worker_license.rpcAsset.id), address(this.params.license_context.owner));
        let workerLicenseMetadataPda = await findWorkerLicenseMetadataPDA(address(this.worker_license.rpcAsset.id));
        let bmbStatePda = await BMBStateAccount.findPDA();
        let accounts = [
            { address: this.payer.address, role: AccountRole.READONLY_SIGNER },
            { address: globalRewardsPda[0], role: AccountRole.WRITABLE },
            { address: proofPda[0], role: AccountRole.WRITABLE },
            { address: workerMetadataPda[0], role: AccountRole.READONLY },
            { address: workerLicenseMetadataPda[0], role: AccountRole.READONLY },
            { address: MPL_ACCOUNT_COMPRESSION_PROGRAM, role: AccountRole.READONLY },
            { address: address(this.worker_license.merkleTree), role: AccountRole.READONLY },
            { address: bmbStatePda[0], role: AccountRole.READONLY },
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
