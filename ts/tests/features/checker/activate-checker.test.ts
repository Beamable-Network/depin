import { describe, expect, it } from 'vitest';

import { ActivateChecker, CheckerMetadataAccount } from 'beamable-network-depin';
import { address, none } from 'gill';
import { LiteDepin } from '../../helpers/lite-depin.js';

describe('Checker activation', async () => {
    const lite = new LiteDepin();

    const signer = await lite.generateKeyPair();
    await lite.airdrop(signer, 10);

    await lite.createLicenseTree({ creator: signer });

    it('should be able to activate a checker', async () => {
        const lic1 = await lite.mintLicense({ to: signer, creator: signer });

        const activateCheckerInput = new ActivateChecker({
            checker_license: lic1,
            delegated_to: signer.address,
            signer: signer.address
        });

        const result = lite.buildTransaction()
            .addInstruction(await activateCheckerInput.getInstruction())
            .sendTransaction({ payer: signer });

        console.log("Checker activated successfully with logs:", result.logs);

        // Verify the checker metadata account was created with correct data
        const checkerMetadataPDA = await CheckerMetadataAccount.findCheckerMetadataPDA(
            address(lic1.rpcAsset.id),
            signer.address
        );

        const accountData = lite.getAccountData(checkerMetadataPDA[0]);
        expect(accountData).not.toBeNull();

        const checkerMetadata = CheckerMetadataAccount.deserializeFrom(accountData!);
        expect(checkerMetadata.suspendedAt).toEqual(none());
        expect(checkerMetadata.delegatedTo).toBe(signer.address);
    });

    it('shouldn\'t be able to activate someone else checker', async () => {
        const userDoe = await lite.generateKeyPair();
        await lite.airdrop(userDoe, 10);

        const lic1 = await lite.mintLicense({ to: signer, creator: signer });

        const activateCheckerInput = new ActivateChecker({
            checker_license: lic1,
            delegated_to: signer.address,
            signer: userDoe.address
        });

        await expect(async () => {
            lite.buildTransaction()
                .addInstruction(await activateCheckerInput.getInstruction())
                .sendTransaction({ payer: userDoe });
        }).rejects.toThrow('License owner account must be the owner of the cNFT license');
    });

    it('should be able to delegate to a different address', async () => {
        const delegate = await lite.generateKeyPair();
        const lic2 = await lite.mintLicense({ to: signer, creator: signer });

        const activateCheckerInput = new ActivateChecker({
            checker_license: lic2,
            delegated_to: delegate.address,
            signer: signer.address
        });

        const result = lite.buildTransaction()
            .addInstruction(await activateCheckerInput.getInstruction())
            .sendTransaction({ payer: signer });

        console.log("Checker activated with delegation successfully with logs:", result.logs);

        // Verify the checker metadata account has correct delegation
        const checkerMetadataPDA = await CheckerMetadataAccount.findCheckerMetadataPDA(
            address(lic2.rpcAsset.id),
            signer.address
        );

        const accountData = lite.getAccountData(checkerMetadataPDA[0]);
        expect(accountData).not.toBeNull();

        const checkerMetadata = CheckerMetadataAccount.deserializeFrom(accountData!);
        expect(checkerMetadata.suspendedAt).toEqual(none());
        expect(checkerMetadata.delegatedTo).toBe(delegate.address);
    });

    it('should be able to reactivate an existing checker (update delegation)', async () => {
        const newDelegate = await lite.generateKeyPair();
        const lic3 = await lite.mintLicense({ to: signer, creator: signer });

        // First activation
        const firstActivation = new ActivateChecker({
            checker_license: lic3,
            delegated_to: signer.address,
            signer: signer.address
        });

        lite.buildTransaction()
            .addInstruction(await firstActivation.getInstruction())
            .sendTransaction({ payer: signer });

        // Verify first activation
        const checkerMetadataPDA = await CheckerMetadataAccount.findCheckerMetadataPDA(
            address(lic3.rpcAsset.id),
            signer.address
        );

        let accountData = lite.getAccountData(checkerMetadataPDA[0]);
        expect(accountData).not.toBeNull();

        let checkerMetadata = CheckerMetadataAccount.deserializeFrom(accountData!);
        expect(checkerMetadata.delegatedTo).toBe(signer.address);

        // Second activation with different delegation
        const secondActivation = new ActivateChecker({
            checker_license: lic3,
            delegated_to: newDelegate.address,
            signer: signer.address
        });

        const result = lite.buildTransaction()
            .addInstruction(await secondActivation.getInstruction())
            .sendTransaction({ payer: signer });

        console.log("Checker reactivated with new delegation successfully with logs:", result.logs);

        // Verify delegation was updated
        accountData = lite.getAccountData(checkerMetadataPDA[0]);
        expect(accountData).not.toBeNull();

        checkerMetadata = CheckerMetadataAccount.deserializeFrom(accountData!);
        expect(checkerMetadata.suspendedAt).toEqual(none());
        expect(checkerMetadata.delegatedTo).toBe(newDelegate.address);
    });
});