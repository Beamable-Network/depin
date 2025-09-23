import { BMBStateAccount, runBrand, computeProofMerkleRoot } from "@beamable-network/depin";
import { publicKey } from "@metaplex-foundation/umi";
import { WorkerNode } from "../worker.js";

export type AggregatedProof = {
    proofRoot: Uint8Array;
    checkers: Uint8Array; // 64 bytes (512 bits)
    latency: number;
    uptime: number;
};

export interface AggregatedProofProvider {
    getAggregatedProof(period: number): Promise<AggregatedProof | null>;
}

export class S3AggregatedProofProvider implements AggregatedProofProvider {

    constructor(private readonly worker: WorkerNode) { }

    async getAggregatedProof(period: number): Promise<AggregatedProof | null> {
        // Fetch individual checker proofs from storage
        const proofsWithIndex = await this.worker.getProofStorage().listProofsByPeriod(period);
        if (!proofsWithIndex.length) return null;

        const bmbStateResult = await BMBStateAccount.readFromStateCached(async (address) => {
            const accountData = await this.worker.getUmi().rpc.getAccount(publicKey(address));
            if (!accountData?.exists) return null;
            return accountData.data;
        });

        if (!bmbStateResult) throw new Error("Failed to fetch BMB state account data");
        const checkerCount = bmbStateResult.data.getCheckerCountForPeriod(period);
        if (checkerCount == null) throw new Error(`No checker count found for period ${period}`);

        const brandOutput = runBrand(this.worker.getLicense(), period, checkerCount);

        const checkers = new Uint8Array(64); // 512 bits

        // Create a set of submitted checker indexes for O(1) lookup
        const submittedCheckerIndexes = new Set(proofsWithIndex.map(p => p.checkerIndex));

        // Set bits for checkers that actually submitted proofs
        for (let i = 0; i < brandOutput.length; i++) {
            const eligibleCheckerIndex = brandOutput[i];
            if (submittedCheckerIndexes.has(eligibleCheckerIndex)) {
                const byteIndex = Math.floor(i / 8);
                const bitIndex = i % 8;
                checkers[byteIndex] |= (1 << bitIndex);
            }
        }

        const avgLatency = proofsWithIndex.reduce((s, p) => s + p.proof.payload.metrics.latency, 0) / proofsWithIndex.length;
        const avgUptime = proofsWithIndex.reduce((s, p) => s + p.proof.payload.metrics.uptime, 0) / proofsWithIndex.length;

        const latency = Math.round(avgLatency * 100_000);
        const uptime = Math.round(avgUptime * 100_000);
        
        const proofRoot = computeProofMerkleRoot(proofsWithIndex);

        return { proofRoot, checkers, latency, uptime };
    }
}
