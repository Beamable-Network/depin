import { MerkleTree } from 'merkletreejs';
import { createHash } from 'crypto';
import { WorkerProofListResponse } from '../nodes/types/worker.js';

/**
 * Computes a deterministic 32-byte Merkle root from a list of worker proofs.
 *
 * This function:
 * 1. Sorts proofs by checkerIndex to ensure deterministic ordering
 * 2. Creates leaf hashes from the JSON representation of each proof
 * 3. Builds a Merkle tree using SHA-256
 * 4. Returns the 32-byte Merkle root hash
 *
 * @param proofs Array of proofs with checker indexes
 * @returns 32-byte Merkle root as Uint8Array
 */
export function computeProofMerkleRoot(proofs: WorkerProofListResponse): Uint8Array {
    if (proofs.length === 0) {
        // Return zero hash for empty proof list
        return new Uint8Array(32);
    }

    // Sort proofs by checkerIndex for deterministic ordering
    const sortedProofs = proofs.toSorted((a, b) => a.checkerIndex - b.checkerIndex);

    // Create leaf hashes from proof data
    const leaves = sortedProofs.map(proofWithIndex => {
        const leafJson = JSON.stringify(proofWithIndex);
        return createHash('sha256').update(leafJson, 'utf8').digest();
    });

    // Build Merkle tree
    const tree = new MerkleTree(leaves, createHash('sha256'), {
        sortPairs: true, // Ensure deterministic ordering of pairs
        duplicateOdd: true // Handle odd number of leaves consistently
    });

    const root = tree.getRoot();
    return new Uint8Array(root);
}