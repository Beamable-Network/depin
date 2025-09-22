import { Address } from 'gill';
import { beforeEach, describe, expect, it } from 'vitest';

import { GlobalRewardsAccount, LockedTokensAccount, PayoutCheckerRewards, TreasuryConfigAccount, TreasuryStateAccount, getCurrentPeriod } from '@beamable-network/depin';
import { AssetWithProof } from '@metaplex-foundation/mpl-bubblegum';
import { activateChecker, activateCheckerLicenses, createCheckers, standardNetworkSetup } from '../../helpers/bmb-utils.js';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';

describe('Payout checker rewards', async () => {
    let lite: LiteDepin;
    let authority: LiteKeyPair;
    let checkerOwner: LiteKeyPair;
    let checkerLicense: AssetWithProof;

    beforeEach(async () => {
        lite = new LiteDepin();
        authority = await lite.generateKeyPair();
        await standardNetworkSetup({ lite, signer: authority });
        await activateCheckerLicenses({ lite, signer: authority, count: 1000 });
        const [owner, license] = (await createCheckers({ signer: authority, lite, count: 1 }))[0];
        checkerOwner = owner;
        checkerLicense = license;

        await activateChecker({ lite, signer: checkerOwner, lic: checkerLicense, delegate: checkerOwner.address });
        await lite.airdrop(checkerOwner, 5);

        lite.goToPeriod(getCurrentPeriod());
    });

    it('should create locked tokens on payout after claiming', async () => {
        const mockedRewards = 5_000;

        // Set up mocked rewards in GlobalRewards account for the checker index
        const checkerIndex = checkerLicense.index; // Use index as checker index
        await setMockedRewardsInGlobalRewards(lite, checkerIndex, mockedRewards);

        const payout = new PayoutCheckerRewards({
            signer: checkerOwner.address,
            checker_license: checkerLicense,
        });

        // Execute payout transaction
        const cfg = await getTreasuryConfig(lite);
        const payoutResult = await lite.buildTransaction()
            .addInstruction(await payout.getInstruction(cfg))
            .sendTransaction({ payer: checkerOwner });
        expect(payoutResult.logs).toBeDefined();

        // Verify all account states after payout
        const currentPeriod = getCurrentPeriod();
        await verifyLockedTokensAccount(lite, checkerOwner.address, currentPeriod, BigInt(mockedRewards));
        await verifyGlobalRewardsReset(lite, checkerIndex);
        await verifyTreasuryState(lite, BigInt(mockedRewards));
    });

    it('should fail when trying to payout with zero rewards', async () => {
        const payout = new PayoutCheckerRewards({
            signer: checkerOwner.address,
            checker_license: checkerLicense,
        });

        // Should fail with insufficient funds error
        const cfg = await getTreasuryConfig(lite);
        await expect(async () => {
            return lite.buildTransaction()
                .addInstruction(await payout.getInstruction(cfg))
                .sendTransaction({ payer: checkerOwner });
        }).rejects.toThrow("Transaction failed");
    });



    it('should fail when trying to payout rewards for someone else', async () => {
        const mockedRewards = 4_000;
        const checkerIndex = checkerLicense.index;
        await setMockedRewardsInGlobalRewards(lite, checkerIndex, mockedRewards);

        // Create another user who tries to payout rewards for the checker owner
        const unauthorizedUser = await lite.generateKeyPair();
        await lite.airdrop(unauthorizedUser, 5);

        const payout = new PayoutCheckerRewards({
            signer: unauthorizedUser.address, // Unauthorized signer
            checker_license: checkerLicense,
        });

        // Should fail with missing required signature error
        const cfg = await getTreasuryConfig(lite);
        await expect(async () => {
            return lite.buildTransaction()
                .addInstruction(await payout.getInstruction(cfg))
                .sendTransaction({ payer: unauthorizedUser });
        }).rejects.toThrow("MissingRequiredSignature");
    });

    it('should allow both owner and delegate to payout when delegate is different', async () => {
        const delegate = await lite.generateKeyPair();
        await lite.airdrop(delegate, 5);

        // Create checker license (authority creates it) and activate it with separate owner and delegate
        const [checkerOwner, checkerLicese] = (await createCheckers({ signer: authority, lite, count: 1 }))[0];
        await lite.airdrop(checkerOwner, 5);

        // Now activate it with a different delegate
        await activateChecker({
            lite,
            signer: checkerOwner,
            lic: checkerLicese,
            delegate: delegate.address // Delegate is different from owner
        });

        const mockedRewards = 6_000;
        const checkerIndex = checkerLicese.index;

        // Test 1: Owner should be able to payout
        await setMockedRewardsInGlobalRewards(lite, checkerIndex, mockedRewards);

        const currentPeriod = getCurrentPeriod();

        const payoutByOwner = new PayoutCheckerRewards({
            signer: checkerOwner.address, // Owner trying to payout
            checker_license: checkerLicese,
        });

        const cfg = await getTreasuryConfig(lite);
        const ownerPayoutResult = await lite.buildTransaction()
            .addInstruction(await payoutByOwner.getInstruction(cfg))
            .sendTransaction({ payer: checkerOwner });
        expect(ownerPayoutResult.logs).toBeDefined();

        // Verify the owner payout worked and balance was reset
        await verifyLockedTokensAccount(lite, checkerOwner.address, currentPeriod, BigInt(mockedRewards));
        await verifyGlobalRewardsReset(lite, checkerIndex);
        await verifyTreasuryState(lite, BigInt(mockedRewards));

        // Test 2: Set up rewards again and test delegate payout
        const additionalRewards = 3_000;
        await setMockedRewardsInGlobalRewards(lite, checkerIndex, additionalRewards);

        const payoutByDelegate = new PayoutCheckerRewards({
            signer: delegate.address, // Delegate trying to payout
            checker_license: checkerLicese,
        });

        const cfg2 = await getTreasuryConfig(lite);
        const delegatePayoutResult = await lite.buildTransaction()
            .addInstruction(await payoutByDelegate.getInstruction(cfg2))
            .sendTransaction({ payer: delegate });
        expect(delegatePayoutResult.logs).toBeDefined();

        // Verify the delegate payout worked
        // IMPORTANT: Even though delegate executed the payout, locked tokens should be owned by the license owner
        // Since this is the same period, tokens should be accumulated in the same PDA
        await verifyLockedTokensAccount(lite, checkerOwner.address, currentPeriod, BigInt(mockedRewards + additionalRewards));
        await verifyGlobalRewardsReset(lite, checkerIndex);
        await verifyTreasuryState(lite, BigInt(mockedRewards + additionalRewards));

        // Additional verification: Ensure delegate does NOT own any locked tokens
        await verifyNoLockedTokensForAddress(lite, delegate.address, currentPeriod);
    });

    it('should accumulate rewards in same locked tokens account for multiple checkers with same owner in the same period', async () => {
        // Create a single owner and mint two licenses to that owner
        const singleOwner = await lite.generateKeyPair();
        await lite.airdrop(singleOwner, 5);

        // Mint two licenses to the same owner
        const checker1License = await lite.mintLicense({ creator: authority, to: singleOwner });
        const checker2License = await lite.mintLicense({ creator: authority, to: singleOwner });

        // Activate both checkers
        await activateChecker({ lite, signer: singleOwner, lic: checker1License, delegate: singleOwner.address });
        await activateChecker({ lite, signer: singleOwner, lic: checker2License, delegate: singleOwner.address });

        const rewards1 = 3_000;
        const rewards2 = 2_000;
        const totalRewards = rewards1 + rewards2;

        // Set up mocked rewards for both checkers
        await setMockedRewardsInGlobalRewards(lite, checker1License.index, rewards1);
        await setMockedRewardsInGlobalRewards(lite, checker2License.index, rewards2);

        const currentPeriod = getCurrentPeriod();

        // Payout for first checker
        const payout1 = new PayoutCheckerRewards({
            signer: singleOwner.address,
            checker_license: checker1License,
        });

        const cfg = await getTreasuryConfig(lite);
        const payout1Result = await lite.buildTransaction()
            .addInstruction(await payout1.getInstruction(cfg))
            .sendTransaction({ payer: singleOwner });
        expect(payout1Result.logs).toBeDefined();
        expect(payout1Result.logs?.some(log => log.includes("Created new LockedTokens account"))).toBe(true); // First time, should create account

        // Verify first payout created locked tokens account with first reward amount
        await verifyLockedTokensAccount(lite, singleOwner.address, currentPeriod, BigInt(rewards1));

        // Payout for second checker (same owner)
        const payout2 = new PayoutCheckerRewards({
            signer: singleOwner.address,
            checker_license: checker2License,
        });

        const cfg2 = await getTreasuryConfig(lite);
        const payout2Result = await lite.buildTransaction()
            .addInstruction(await payout2.getInstruction(cfg2))
            .sendTransaction({ payer: singleOwner });
        expect(payout2Result.logs).toBeDefined();
        expect(payout2Result.logs?.some(log => log.includes("Created new LockedTokens account"))).toBe(false); // Second time, should NOT create new account

        // Verify that the same locked tokens account now contains accumulated rewards
        await verifyLockedTokensAccount(lite, singleOwner.address, currentPeriod, BigInt(totalRewards));

        // Verify both checkers' balances were reset
        await verifyGlobalRewardsReset(lite, checker1License.index);
        await verifyGlobalRewardsReset(lite, checker2License.index);

        // Verify treasury state reflects total locked amount
        await verifyTreasuryState(lite, BigInt(totalRewards));
    });

    it('should create separate locked tokens accounts for different periods', async () => {
        // Create a checker
        const singleOwner = await lite.generateKeyPair();
        await lite.airdrop(singleOwner, 5);
        const checkerLicense = await lite.mintLicense({ creator: authority, to: singleOwner });
        await activateChecker({ lite, signer: singleOwner, lic: checkerLicense, delegate: singleOwner.address });

        const rewardsPeriod1 = 4_000;
        const rewardsPeriod2 = 6_000;

        // === PERIOD 1 ===
        const period1 = getCurrentPeriod();

        // Set rewards and payout for period 1
        await setMockedRewardsInGlobalRewards(lite, checkerLicense.index, rewardsPeriod1);

        const payout1 = new PayoutCheckerRewards({
            signer: singleOwner.address,
            checker_license: checkerLicense,
        });

        const cfg1 = await getTreasuryConfig(lite);
        const payout1Result = await lite.buildTransaction()
            .addInstruction(await payout1.getInstruction(cfg1))
            .sendTransaction({ payer: singleOwner });
        expect(payout1Result.logs).toBeDefined();

        // Verify period 1 locked tokens account
        await verifyLockedTokensAccount(lite, singleOwner.address, period1, BigInt(rewardsPeriod1));

        // === MOVE TO PERIOD 2 ===
        const period2 = period1 + 1;
        lite.goToPeriod(period2);

        // Set rewards and payout for period 2
        await setMockedRewardsInGlobalRewards(lite, checkerLicense.index, rewardsPeriod2);

        const payout2 = new PayoutCheckerRewards({
            signer: singleOwner.address,
            checker_license: checkerLicense,
        });

        const cfg = await getTreasuryConfig(lite);
        const payout2Result = await lite.buildTransaction()
            .addInstruction(await payout2.getInstruction(cfg, period2))
            .sendTransaction({ payer: singleOwner });
        expect(payout2Result.logs).toBeDefined();

        // Verify period 2 locked tokens account (separate from period 1)
        await verifyLockedTokensAccount(lite, singleOwner.address, period2, BigInt(rewardsPeriod2));

        // Verify period 1 locked tokens account still exists with original amount
        await verifyLockedTokensAccount(lite, singleOwner.address, period1, BigInt(rewardsPeriod1));

        // Verify treasury state reflects total locked amount from both periods
        await verifyTreasuryState(lite, BigInt(rewardsPeriod1 + rewardsPeriod2));

        // Verify that the PDAs are different for different periods
        const period1Pda = await LockedTokensAccount.findLockedTokensPDA(singleOwner.address, period1, period1 + 365);
        const period2Pda = await LockedTokensAccount.findLockedTokensPDA(singleOwner.address, period2, period2 + 365);
        expect(period1Pda[0]).not.toBe(period2Pda[0]); // Different PDA addresses
    });
});

// Helper functions
async function setMockedRewardsInGlobalRewards(
    lite: LiteDepin,
    checkerIndex: number,
    rewardsAmount: number
): Promise<void> {
    const globalRewardsPda = await GlobalRewardsAccount.findGlobalRewardsPDA();
    const current = lite.getAccountData(globalRewardsPda[0]);
    if (!current) throw new Error('GlobalRewards account not found');

    const globalRewards = GlobalRewardsAccount.deserializeFrom(current);
    globalRewards.checkers[checkerIndex] = rewardsAmount;
    const updated = GlobalRewardsAccount.serialize(globalRewards);
    lite.setAccountData(globalRewardsPda[0], updated);
}

async function verifyLockedTokensAccount(
    lite: LiteDepin,
    ownerAddress: Address,
    lockPeriod: number,
    expectedAmount: bigint
): Promise<void> {
    const lockedTokensPda = await LockedTokensAccount.findLockedTokensPDA(ownerAddress, lockPeriod, lockPeriod + 365);
    const lockedTokensAccountData = lite.getAccountData(lockedTokensPda[0]);
    expect(lockedTokensAccountData).not.toBeNull();

    const lockedTokens = LockedTokensAccount.deserializeFrom(lockedTokensAccountData!);
    expect(lockedTokens.owner).toBe(ownerAddress as any);
    expect(lockedTokens.totalLocked).toBe(expectedAmount);
}

async function verifyTreasuryState(lite: LiteDepin, expectedLockedBalance: bigint): Promise<void> {
    const treasuryStatePda = await TreasuryStateAccount.findTreasuryStatePDA();
    const treasuryStateAccountData = lite.getAccountData(treasuryStatePda[0]);
    expect(treasuryStateAccountData).not.toBeNull();

    const treasuryState = TreasuryStateAccount.deserializeFrom(treasuryStateAccountData!);
    expect(treasuryState.lockedBalance).toBe(expectedLockedBalance);
}

async function verifyGlobalRewardsReset(
    lite: LiteDepin,
    checkerIndex: number
): Promise<void> {
    const globalRewardsPda = await GlobalRewardsAccount.findGlobalRewardsPDA();
    const globalRewardsData = lite.getAccountData(globalRewardsPda[0]);
    expect(globalRewardsData).not.toBeNull();

    const globalRewards = GlobalRewardsAccount.deserializeFrom(globalRewardsData!);
    expect(globalRewards.checkers[checkerIndex]).toBe(0);
}

async function verifyNoLockedTokensForAddress(
    lite: LiteDepin,
    address: Address,
    lockPeriod: number
): Promise<void> {
    const lockedTokensPda = await LockedTokensAccount.findLockedTokensPDA(address, lockPeriod, lockPeriod + 365);
    const lockedTokensAccountData = lite.getAccountData(lockedTokensPda[0]);

    // The account should not exist (should be null) since no locked tokens were created for this address
    expect(lockedTokensAccountData).toBeNull();
}

async function getTreasuryConfig(lite: LiteDepin): Promise<{ address: Address; data: TreasuryConfigAccount }> {
    const cfg = await TreasuryConfigAccount.readFromState((addr) => lite.getAccountData(addr));
    if (!cfg) throw new Error('TreasuryConfig not found');
    return cfg;
}
