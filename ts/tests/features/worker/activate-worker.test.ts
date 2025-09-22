import { describe, expect, it } from 'vitest';

import { ActivateWorker, WorkerMetadataAccount } from '@beamable-network/depin';
import { address, none } from 'gill';
import { LiteDepin } from '../../helpers/lite-depin.js';

describe('Worker activation', async () => {
    const lite = new LiteDepin();

    const signer = await lite.generateKeyPair();
    await lite.airdrop(signer, 10);

    await lite.createLicenseTree({ creator: signer });

    it('should be able to activate a worker', async () => {
        const lic1 = await lite.mintLicense({ to: signer, creator: signer });

        const activateWorkerInput = new ActivateWorker({
            worker_license: lic1,
            delegated_to: signer.address,
            discovery_uri: "https://example.com/worker/1",
            signer: signer.address
        });

        const result = lite.buildTransaction()
            .addInstruction(await activateWorkerInput.getInstruction())
            .sendTransaction({ payer: signer });

        console.log("Worker activated successfully with logs:", result.logs);

        // Verify the worker metadata account was created with correct data
        const workerMetadataPDA = await WorkerMetadataAccount.findWorkerMetadataPDA(
            address(lic1.rpcAsset.id),
            signer.address
        );

        const accountData = lite.getAccountData(workerMetadataPDA[0]);
        expect(accountData).not.toBeNull();

        const workerMetadata = WorkerMetadataAccount.deserializeFrom(accountData!);
        expect(workerMetadata.suspendedAt).toEqual(none());
        expect(workerMetadata.delegatedTo).toBe(signer.address);
        expect(workerMetadata.discoveryUri).toBe("https://example.com/worker/1");
    });

    it('shouldn\'t be able to activate someone else worker', async () => {
        const userDoe = await lite.generateKeyPair();
        await lite.airdrop(userDoe, 10);

        const lic1 = await lite.mintLicense({ to: signer, creator: signer });

        const activateWorkerInput = new ActivateWorker({
            worker_license: lic1,
            delegated_to: signer.address,
            discovery_uri: "https://example.com/worker/2",
            signer: userDoe.address
        });

        await expect(async () => {
            lite.buildTransaction()
                .addInstruction(await activateWorkerInput.getInstruction())
                .sendTransaction({ payer: userDoe });
        }).rejects.toThrow('License owner account must be the owner of the cNFT license');
    });

    it('should be able to delegate to a different address', async () => {
        const delegate = await lite.generateKeyPair();
        const lic2 = await lite.mintLicense({ to: signer, creator: signer });

        const activateWorkerInput = new ActivateWorker({
            worker_license: lic2,
            delegated_to: delegate.address,
            discovery_uri: "https://example.com/worker/3",
            signer: signer.address
        });

        const result = lite.buildTransaction()
            .addInstruction(await activateWorkerInput.getInstruction())
            .sendTransaction({ payer: signer });

        console.log("Worker activated with delegation successfully with logs:", result.logs);

        // Verify the worker metadata account has correct delegation
        const workerMetadataPDA = await WorkerMetadataAccount.findWorkerMetadataPDA(
            address(lic2.rpcAsset.id),
            signer.address
        );

        const accountData = lite.getAccountData(workerMetadataPDA[0]);
        expect(accountData).not.toBeNull();

        const workerMetadata = WorkerMetadataAccount.deserializeFrom(accountData!);
        expect(workerMetadata.suspendedAt).toEqual(none());
        expect(workerMetadata.delegatedTo).toBe(delegate.address);
        expect(workerMetadata.discoveryUri).toBe("https://example.com/worker/3");
    });

    it('should be able to reactivate an existing worker (update delegation and URI)', async () => {
        const newDelegate = await lite.generateKeyPair();
        const lic3 = await lite.mintLicense({ to: signer, creator: signer });

        // First activation
        const firstActivation = new ActivateWorker({
            worker_license: lic3,
            delegated_to: signer.address,
            discovery_uri: "https://example.com/worker/4",
            signer: signer.address
        });

        lite.buildTransaction()
            .addInstruction(await firstActivation.getInstruction())
            .sendTransaction({ payer: signer });

        // Verify first activation
        const workerMetadataPDA = await WorkerMetadataAccount.findWorkerMetadataPDA(
            address(lic3.rpcAsset.id),
            signer.address
        );

        let accountData = lite.getAccountData(workerMetadataPDA[0]);
        expect(accountData).not.toBeNull();

        let workerMetadata = WorkerMetadataAccount.deserializeFrom(accountData!);
        expect(workerMetadata.delegatedTo).toBe(signer.address);
        expect(workerMetadata.discoveryUri).toBe("https://example.com/worker/4");

        // Second activation with different delegation and URI
        const secondActivation = new ActivateWorker({
            worker_license: lic3,
            delegated_to: newDelegate.address,
            discovery_uri: "https://updated.example.com/worker/4",
            signer: signer.address
        });

        const result = lite.buildTransaction()
            .addInstruction(await secondActivation.getInstruction())
            .sendTransaction({ payer: signer });

        console.log("Worker reactivated with new delegation and URI successfully with logs:", result.logs);

        // Verify delegation and URI were updated
        accountData = lite.getAccountData(workerMetadataPDA[0]);
        expect(accountData).not.toBeNull();

        workerMetadata = WorkerMetadataAccount.deserializeFrom(accountData!);
        expect(workerMetadata.suspendedAt).toEqual(none());
        expect(workerMetadata.delegatedTo).toBe(newDelegate.address);
        expect(workerMetadata.discoveryUri).toBe("https://updated.example.com/worker/4");
    });

    it('should handle different discovery URI formats/lengths', async () => {
        const lic4 = await lite.generateKeyPair();
        await lite.airdrop(lic4, 10);
        const workerLic = await lite.mintLicense({ to: lic4, creator: signer });

        const testUris = [
            "https://ipfs.io/ipfs/QmHash123",
            "https://api.worker.com/v1/metadata",
            "https://worker-discovery.example.org/node/1234"
        ];

        for (const [index, uri] of testUris.entries()) {
            const activateWorkerInput = new ActivateWorker({
                worker_license: workerLic,
                delegated_to: lic4.address,
                discovery_uri: uri,
                signer: lic4.address
            });

            const result = lite.buildTransaction()
                .addInstruction(await activateWorkerInput.getInstruction())
                .sendTransaction({ payer: lic4 });

            console.log(`Worker activated with URI format ${index + 1} (${uri}) successfully with logs:`, result.logs);

            // Verify the worker metadata account has the correct URI
            const workerMetadataPDA = await WorkerMetadataAccount.findWorkerMetadataPDA(
                address(workerLic.rpcAsset.id),
                lic4.address
            );

            const accountData = lite.getAccountData(workerMetadataPDA[0]);
            expect(accountData).not.toBeNull();

            const workerMetadata = WorkerMetadataAccount.deserializeFrom(accountData!);
            expect(workerMetadata.suspendedAt).toEqual(none());
            expect(workerMetadata.delegatedTo).toBe(lic4.address);
            expect(workerMetadata.discoveryUri).toBe(uri);
        }
    });
});