import { describe, expect, it } from 'vitest';

import {
    findWorkerProofPDA,
    GlobalRewardsAccount,
    runBrand,
    SubmitWorkerProof,
    WorkerProofAccount
} from 'beamable-network-depin';
import bs58 from 'bs58';
import { randomBytes } from 'crypto';
import { address } from 'gill';
import { activateCheckerLicenses, createAndActivateWorker, standardNetworkSetup } from '../../helpers/bmb-utils.js';
import { LiteDepin } from '../../helpers/lite-depin.js';

describe('Submit worker proofs', async () => {
    const lite = new LiteDepin();
    const authority = await lite.generateKeyPair();
    await standardNetworkSetup({ lite, signer: authority });
    await activateCheckerLicenses({ lite, signer: authority, count: 1000 });
    const worker = await createAndActivateWorker({ lite, signer: authority, owner: authority });

    // Advance time to period 2 so we can submit for period 1
    lite.goToPeriod(2);
    const targetPeriod = 1; // Submit for period 1 (the previous period when current is 2)

    // Setup checker bitmap with specific bits set
    const checkersBitmap = new Uint8Array(64);
    checkersBitmap[0] |= 0b00000001; // Set bit 0
    checkersBitmap[0] |= 0b00000010; // Set bit 1
    checkersBitmap[1] |= 0b00000001; // Set bit 8
    checkersBitmap[8] |= 0b00000001; // Set bit 64

    const submitWorkerProofInput = new SubmitWorkerProof({
        payer: authority.transactionSigner,
        worker_license: worker,
        proof_root: randomBytes(32),
        checkers: checkersBitmap,
        period: targetPeriod,
        latency: 50 * 100_000, // 50ms in microseconds
        uptime: 99 * 100_000   // 99% uptime
    });

    it('should successfully submit proof, create account with correct data, and assign checker rewards', async () => {
        // Submit proof
        const result = await lite.buildTransaction()
            .addInstruction(await submitWorkerProofInput.getInstruction())
            .sendTransaction({ payer: authority });

        expect(result.logs).toBeDefined();
        console.log('Submit proof transaction confirmed');

        // Verify worker proof account was created with correct data
        const workerProofPDA = await findWorkerProofPDA(
            address(worker.rpcAsset.id),
            targetPeriod
        );

        const proofAccountData = lite.getAccountData(workerProofPDA[0]);
        expect(proofAccountData).not.toBeNull();
        expect(proofAccountData!.length).toBeGreaterThan(0);

        const workerProof = WorkerProofAccount.deserializeFrom(proofAccountData);
        expect(workerProof.period).toBe(targetPeriod);
        expect(workerProof.uptime).toBe(99 * 100_000);
        expect(workerProof.latency).toBe(50 * 100_000);

        // Verify checker rewards were assigned correctly
        const globalRewardsPda = await GlobalRewardsAccount.findGlobalRewardsPDA();
        const globalRewardsData = lite.getAccountData(globalRewardsPda[0]);
        const globalRewards = GlobalRewardsAccount.deserializeFrom(globalRewardsData);

        // Should have exactly 4 checkers with rewards (matching our bitmap)
        expect(globalRewards.checkers.filter(value => value > 0).length).toBe(4);

        // Verify BRAND algorithm was applied correctly
        const brandOutput = runBrand(bs58.decode(worker.rpcAsset.id), targetPeriod, 1000);

        expect(globalRewards.checkers[brandOutput[0]]).toBeGreaterThan(0);
        expect(globalRewards.checkers[brandOutput[1]]).toBeGreaterThan(0);
        expect(globalRewards.checkers[brandOutput[8]]).toBeGreaterThan(0);
        expect(globalRewards.checkers[brandOutput[64]]).toBeGreaterThan(0);
    });

    it('should reject invalid proof submissions and allow duplicate after first submission', async () => {
        // Create a separate worker for this test to avoid conflicts
        const testWorker = await createAndActivateWorker({ lite, signer: authority, owner: authority });

        // First submit a valid proof to test duplicate later
        const firstSubmission = new SubmitWorkerProof({
            payer: authority.transactionSigner,
            worker_license: testWorker,
            proof_root: randomBytes(32),
            checkers: checkersBitmap,
            period: targetPeriod,
            latency: 50 * 100_000,
            uptime: 99 * 100_000
        });

        const firstResult = await lite.buildTransaction()
            .addInstruction(await firstSubmission.getInstruction())
            .sendTransaction({ payer: authority });
        expect(firstResult.logs).toBeDefined();

        // Test duplicate submission
        const duplicateSubmission = new SubmitWorkerProof({
            payer: authority.transactionSigner,
            worker_license: testWorker,
            proof_root: randomBytes(32),
            checkers: checkersBitmap,
            period: targetPeriod,
            latency: 45 * 100_000,
            uptime: 98 * 100_000
        });

        await expect(async () => {
            return lite.buildTransaction()
                .addInstruction(await duplicateSubmission.getInstruction())
                .sendTransaction({ payer: authority });
        }).rejects.toThrow("AccountAlreadyInitialized");

        // Test future period submission
        const currentPeriod = lite.getPeriod();
        const futureSubmission = new SubmitWorkerProof({
            payer: authority.transactionSigner,
            worker_license: testWorker,
            proof_root: randomBytes(32),
            checkers: checkersBitmap,
            period: currentPeriod + 1,
            latency: 45 * 100_000,
            uptime: 98 * 100_000
        });

        await expect(async () => {
            return lite.buildTransaction()
                .addInstruction(await futureSubmission.getInstruction())
                .sendTransaction({ payer: authority });
        }).rejects.toThrow("Can only submit proof for the previous period");

        // Test invalid past period submission
        const invalidPastSubmission = new SubmitWorkerProof({
            payer: authority.transactionSigner,
            worker_license: testWorker,
            proof_root: randomBytes(32),
            checkers: checkersBitmap,
            period: currentPeriod - 2, // Two periods ago (invalid)
            latency: 45 * 100_000,
            uptime: 98 * 100_000
        });

        await expect(async () => {
            return lite.buildTransaction()
                .addInstruction(await invalidPastSubmission.getInstruction())
                .sendTransaction({ payer: authority });
        }).rejects.toThrow("Can only submit proof for the previous period");

        // Test unauthorized signer
        const otherOwner = await lite.generateKeyPair();
        const otherWorker = await createAndActivateWorker({ lite, signer: authority, owner: otherOwner });

        const unauthorizedSubmission = new SubmitWorkerProof({
            payer: authority.transactionSigner,
            worker_license: otherWorker,
            proof_root: randomBytes(32),
            checkers: checkersBitmap,
            period: targetPeriod,
            latency: 45 * 100_000,
            uptime: 98 * 100_000
        });

        await expect(async () => {
            return lite.buildTransaction()
                .addInstruction(await unauthorizedSubmission.getInstruction())
                .sendTransaction({ payer: authority });
        }).rejects.toThrow("Transaction signer is not authorized to submit proofs for this worker");
    });

    it('should enforce delegate permissions (only delegate can submit, not owner)', async () => {
        const owner = await lite.generateKeyPair();
        const delegate = await lite.generateKeyPair();
        await lite.airdrop(owner, 5);
        await lite.airdrop(delegate, 5);
        const workerWithDelegate = await createAndActivateWorker({
            lite,
            signer: authority,
            owner,
            delegate
        });

        // Owner tries to submit proof but should fail since delegate is different
        const ownerSubmission = new SubmitWorkerProof({
            payer: owner.transactionSigner,
            worker_license: workerWithDelegate,
            proof_root: randomBytes(32),
            checkers: checkersBitmap,
            period: targetPeriod,
            latency: 45 * 100_000,
            uptime: 98 * 100_000
        });

        await expect(async () => {
            return lite.buildTransaction()
                .addInstruction(await ownerSubmission.getInstruction())
                .sendTransaction({ payer: owner });
        }).rejects.toThrow("Transaction signer is not authorized to submit proofs for this worker");

        // Delegate should succeed
        const delegateSubmission = new SubmitWorkerProof({
            payer: delegate.transactionSigner,
            worker_license: workerWithDelegate,
            proof_root: randomBytes(32),
            checkers: checkersBitmap,
            period: targetPeriod,
            latency: 45 * 100_000,
            uptime: 98 * 100_000
        });

        const result = await lite.buildTransaction()
            .addInstruction(await delegateSubmission.getInstruction())
            .sendTransaction({ payer: delegate });

        expect(result.logs).toBeDefined();

        // Verify the proof was actually submitted
        const workerProofPDA = await findWorkerProofPDA(
            address(workerWithDelegate.rpcAsset.id),
            targetPeriod
        );
        const proofAccountData = lite.getAccountData(workerProofPDA[0]);
        expect(proofAccountData).not.toBeNull();
    });
});