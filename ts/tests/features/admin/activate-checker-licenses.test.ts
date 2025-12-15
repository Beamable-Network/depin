import { assert, beforeEach, describe, expect, it } from 'vitest';

import { ActivateCheckerLicenses, BMBStateAccount, DEPIN_PROGRAM } from '@beamable-network/depin';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';

describe('Checker licenses activation', async () => {
    let lite: LiteDepin;
    let admin: LiteKeyPair;

    beforeEach(async () => {
        lite = new LiteDepin();
        admin = await lite.generateKeyPair();
        lite.setProgramUpgradeAuthority(DEPIN_PROGRAM, admin.web3PublicKey);
        await lite.airdrop(admin, 10);
    });

    it('should be able to activate checker licenses', async () => {
        lite.goToPeriod(0);

        const activate = new ActivateCheckerLicenses({
            checker_count: 1000,
            period: 1,
            signer: admin.address
        });

        lite.buildTransaction()
            .addInstruction(await activate.getInstruction())
            .sign(admin)
            .sendTransaction({ payer: admin });

        lite.goToPeriod(1);

        const stateAccountPda = await BMBStateAccount.findPDA();
        const stateAccountDataBytes = lite.getAccountData(stateAccountPda[0]);

        assert.isNotNull(stateAccountDataBytes, 'BMBState account should exist after activating licenses');
        const stateAccount = BMBStateAccount.deserializeFrom(stateAccountDataBytes!);
        expect(stateAccount.getCheckerCountForPeriod(1)).toEqual(1000);
    });

    it('should not allow activating checkers for current or past periods', async () => {
        // Go to period 5 to test current and past period validation
        lite.goToPeriod(5);

        // Test attempting to activate for current period (5)
        const activateCurrentPeriod = new ActivateCheckerLicenses({
            checker_count: 500,
            period: 5, // Current period
            signer: admin.address
        });

        await expect(async () => {
            lite.buildTransaction()
                .addInstruction(await activateCurrentPeriod.getInstruction())
                .sign(admin)
                .sendTransaction({ payer: admin });
        }).rejects.toThrow('New period must be equal to current period + 1');

        // Test attempting to activate for past period (3)
        const activatePastPeriod = new ActivateCheckerLicenses({
            checker_count: 500,
            period: 3, // Past period
            signer: admin.address
        });

        await expect(async () => {
            lite.buildTransaction()
                .addInstruction(await activatePastPeriod.getInstruction())
                .sign(admin)
                .sendTransaction({ payer: admin });
        }).rejects.toThrow('New period must be equal to current period + 1');

        // Verify that activating for a future period (6) still works
        const activateFuturePeriod = new ActivateCheckerLicenses({
            checker_count: 750,
            period: 6, // Future period
            signer: admin.address
        });

        lite.buildTransaction()
            .addInstruction(await activateFuturePeriod.getInstruction())
            .sign(admin)
            .sendTransaction({ payer: admin });

        // Verify the future period activation was successful
        const stateAccountPda = await BMBStateAccount.findPDA();
        const stateAccountDataBytes = lite.getAccountData(stateAccountPda[0]);
        const stateAccount = BMBStateAccount.deserializeFrom(stateAccountDataBytes!);
        expect(stateAccount.getCheckerCountForPeriod(6)).toEqual(750);
    });

    it('should allow to change the checker count if already set for period', async () => {
        // Start from period 0 and establish a high checker count
        lite.goToPeriod(0);

        // Activate period 1 with 1000 checkers
        const activateHighCount = new ActivateCheckerLicenses({
            checker_count: 1000,
            period: 1,
            signer: admin.address
        });

        const initialTx = lite.buildTransaction()
            .addInstruction(await activateHighCount.getInstruction())
            .sign(admin)
            .sendTransaction({ payer: admin });

        // Verify the high count was set
        const stateAccountPda = await BMBStateAccount.findPDA();
        let stateAccountDataBytes = lite.getAccountData(stateAccountPda[0]);
        let stateAccount = BMBStateAccount.deserializeFrom(stateAccountDataBytes!);
        expect(stateAccount.getCheckerCountForPeriod(1)).toEqual(1000);

        const changeCount = new ActivateCheckerLicenses({
            checker_count: 500,
            period: 1,
            signer: admin.address
        });

        await lite.buildTransaction()
            .addInstruction(await changeCount.getInstruction())
            .sign(admin)
            .sendTransaction({ payer: admin });

        // Verify the checker count was updated to the new lower value
        stateAccountDataBytes = lite.getAccountData(stateAccountPda[0]);
        stateAccount = BMBStateAccount.deserializeFrom(stateAccountDataBytes!);
        expect(stateAccount.getCheckerCountForPeriod(1)).toEqual(500);
    });
});