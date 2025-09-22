import { describe, expect, it } from 'vitest';

import { ActivateWorker, UpdateWorkerUri, WorkerMetadataAccount } from '@beamable-network/depin';
import { address, none } from 'gill';
import { LiteDepin } from '../../helpers/lite-depin.js';

describe('Worker URI update', async () => {
    const lite = new LiteDepin();

    const signer = await lite.generateKeyPair();
    await lite.airdrop(signer, 10);

    await lite.createLicenseTree({ creator: signer });

    it('should be able to update worker URI when called by delegate', async () => {
        const delegate = await lite.generateKeyPair();
        await lite.airdrop(delegate, 10);

        const lic1 = await lite.mintLicense({ to: signer, creator: signer });

        // First activate the worker
        const activateWorkerInput = new ActivateWorker({
            worker_license: lic1,
            delegated_to: delegate.address,
            discovery_uri: "https://example.com/worker/initial",
            signer: signer.address
        });

        lite.buildTransaction()
            .addInstruction(await activateWorkerInput.getInstruction())
            .sendTransaction({ payer: signer });

        // Verify initial state
        const workerMetadataPDA = await WorkerMetadataAccount.findWorkerMetadataPDA(
            address(lic1.rpcAsset.id),
            signer.address
        );

        let accountData = lite.getAccountData(workerMetadataPDA[0]);
        expect(accountData).not.toBeNull();

        let workerMetadata = WorkerMetadataAccount.deserializeFrom(accountData!);
        expect(workerMetadata.discoveryUri).toBe("https://example.com/worker/initial");

        // Now update the URI using delegate
        const updateWorkerUriInput = new UpdateWorkerUri({
            worker_license: lic1,
            discovery_uri: "https://updated.example.com/worker/new",
            signer: delegate.address
        });

        const result = lite.buildTransaction()
            .addInstruction(await updateWorkerUriInput.getInstruction())
            .sendTransaction({ payer: delegate });

        console.log("Worker URI updated successfully with logs:", result.logs);

        // Verify the URI was updated
        accountData = lite.getAccountData(workerMetadataPDA[0]);
        expect(accountData).not.toBeNull();

        workerMetadata = WorkerMetadataAccount.deserializeFrom(accountData!);
        expect(workerMetadata.suspendedAt).toEqual(none());
        expect(workerMetadata.delegatedTo).toBe(delegate.address);
        expect(workerMetadata.discoveryUri).toBe("https://updated.example.com/worker/new");
    });

    it('shouldn\'t allow owner to update worker URI (only delegate can)', async () => {
        const delegate = await lite.generateKeyPair();
        const lic2 = await lite.mintLicense({ to: signer, creator: signer });

        // First activate the worker
        const activateWorkerInput = new ActivateWorker({
            worker_license: lic2,
            delegated_to: delegate.address,
            discovery_uri: "https://example.com/worker/2",
            signer: signer.address
        });

        lite.buildTransaction()
            .addInstruction(await activateWorkerInput.getInstruction())
            .sendTransaction({ payer: signer });

        // Try to update URI using owner (should fail)
        const updateWorkerUriInput = new UpdateWorkerUri({
            worker_license: lic2,
            discovery_uri: "https://should-fail.example.com/worker/2",
            signer: signer.address
        });

        await expect(async () => {
            lite.buildTransaction()
                .addInstruction(await updateWorkerUriInput.getInstruction())
                .sendTransaction({ payer: signer });
        }).rejects.toThrow('Signer must be the worker delegate (delegated_to from WorkerMetadata)');
    });

    it('shouldn\'t allow random user to update worker URI', async () => {
        const delegate = await lite.generateKeyPair();
        const randomUser = await lite.generateKeyPair();
        await lite.airdrop(randomUser, 10);

        const lic3 = await lite.mintLicense({ to: signer, creator: signer });

        // First activate the worker
        const activateWorkerInput = new ActivateWorker({
            worker_license: lic3,
            delegated_to: delegate.address,
            discovery_uri: "https://example.com/worker/3",
            signer: signer.address
        });

        lite.buildTransaction()
            .addInstruction(await activateWorkerInput.getInstruction())
            .sendTransaction({ payer: signer });

        // Try to update URI using random user (should fail)
        const updateWorkerUriInput = new UpdateWorkerUri({
            worker_license: lic3,
            discovery_uri: "https://should-fail.example.com/worker/3",
            signer: randomUser.address
        });

        await expect(async () => {
            lite.buildTransaction()
                .addInstruction(await updateWorkerUriInput.getInstruction())
                .sendTransaction({ payer: randomUser });
        }).rejects.toThrow('Signer must be the worker delegate (delegated_to from WorkerMetadata)');
    });

    it('shouldn\'t allow updating URI for non-existent worker', async () => {
        const delegate = await lite.generateKeyPair();
        await lite.airdrop(delegate, 10);

        const lic4 = await lite.mintLicense({ to: signer, creator: signer });

        // Don't activate the worker, try to update URI directly
        const updateWorkerUriInput = new UpdateWorkerUri({
            worker_license: lic4,
            discovery_uri: "https://should-fail.example.com/worker/4",
            signer: delegate.address
        });

        await expect(async () => {
            lite.buildTransaction()
                .addInstruction(await updateWorkerUriInput.getInstruction())
                .sendTransaction({ payer: delegate });
        }).rejects.toThrow('WorkerMetadata account does not exist. Worker must be activated first.');
    });

    it('should handle different URI formats/lengths', async () => {
        const delegate = await lite.generateKeyPair();
        await lite.airdrop(delegate, 10);

        const lic5 = await lite.mintLicense({ to: signer, creator: signer });

        // First activate the worker
        const activateWorkerInput = new ActivateWorker({
            worker_license: lic5,
            delegated_to: delegate.address,
            discovery_uri: "https://example.com/worker/5",
            signer: signer.address
        });

        lite.buildTransaction()
            .addInstruction(await activateWorkerInput.getInstruction())
            .sendTransaction({ payer: signer });

        const testUris = [
            "https://ipfs.io/ipfs/QmHashUpdated123",
            "https://api.worker-updated.com/v2/metadata",
            "https://worker-discovery-updated.example.org/node/5678"
        ];

        const workerMetadataPDA = await WorkerMetadataAccount.findWorkerMetadataPDA(
            address(lic5.rpcAsset.id),
            signer.address
        );

        for (const [index, uri] of testUris.entries()) {
            const updateWorkerUriInput = new UpdateWorkerUri({
                worker_license: lic5,
                discovery_uri: uri,
                signer: delegate.address
            });

            const result = lite.buildTransaction()
                .addInstruction(await updateWorkerUriInput.getInstruction())
                .sendTransaction({ payer: delegate });

            console.log(`Worker URI updated with format ${index + 1} (${uri}) successfully with logs:`, result.logs);

            // Verify the URI was updated
            const accountData = lite.getAccountData(workerMetadataPDA[0]);
            expect(accountData).not.toBeNull();

            const workerMetadata = WorkerMetadataAccount.deserializeFrom(accountData!);
            expect(workerMetadata.suspendedAt).toEqual(none());
            expect(workerMetadata.delegatedTo).toBe(delegate.address);
            expect(workerMetadata.discoveryUri).toBe(uri);
        }
    });

    it('should preserve other worker metadata fields when updating URI', async () => {
        const delegate1 = await lite.generateKeyPair();
        const delegate2 = await lite.generateKeyPair();
        await lite.airdrop(delegate1, 10);
        await lite.airdrop(delegate2, 10);

        const lic6 = await lite.mintLicense({ to: signer, creator: signer });

        // First activate the worker with specific delegation
        const activateWorkerInput = new ActivateWorker({
            worker_license: lic6,
            delegated_to: delegate2.address,
            discovery_uri: "https://example.com/worker/6",
            signer: signer.address
        });

        lite.buildTransaction()
            .addInstruction(await activateWorkerInput.getInstruction())
            .sendTransaction({ payer: signer });

        const workerMetadataPDA = await WorkerMetadataAccount.findWorkerMetadataPDA(
            address(lic6.rpcAsset.id),
            signer.address
        );

        // Verify initial state
        let accountData = lite.getAccountData(workerMetadataPDA[0]);
        let workerMetadata = WorkerMetadataAccount.deserializeFrom(accountData!);
        expect(workerMetadata.delegatedTo).toBe(delegate2.address);
        expect(workerMetadata.suspendedAt).toEqual(none());

        // Update the URI using delegate2 (the actual delegated_to address)
        const updateWorkerUriInput = new UpdateWorkerUri({
            worker_license: lic6,
            discovery_uri: "https://updated.example.com/worker/6",
            signer: delegate2.address
        });

        lite.buildTransaction()
            .addInstruction(await updateWorkerUriInput.getInstruction())
            .sendTransaction({ payer: delegate2 });

        // Verify that URI changed but other fields preserved
        accountData = lite.getAccountData(workerMetadataPDA[0]);
        workerMetadata = WorkerMetadataAccount.deserializeFrom(accountData!);
        expect(workerMetadata.suspendedAt).toEqual(none()); // Should remain unchanged
        expect(workerMetadata.delegatedTo).toBe(delegate2.address); // Should remain unchanged
        expect(workerMetadata.discoveryUri).toBe("https://updated.example.com/worker/6"); // Should be updated
    });
});