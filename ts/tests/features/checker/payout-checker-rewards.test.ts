import { Address } from 'gill';
import { beforeEach, describe, expect, it } from 'vitest';

import { GlobalRewardsAccount, FlexlockTokensAccount, PayoutCheckerRewards, CheckerRewardsVault, getCurrentPeriod } from '@beamable-network/depin';
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
        const mockedRewards = 5_000n;

        // Set up mocked rewards in GlobalRewards account for the checker index
        const checkerIndex = checkerLicense.index; // Use index as checker index
        await setMockedRewardsInGlobalRewards(lite, checkerIndex, mockedRewards);

        const payout = new PayoutCheckerRewards({
            signer: checkerOwner.address,
            checker_license: checkerLicense,
        });

        // Execute payout transaction
        const cfg = await getRewardsVault(lite);
        const payoutResult = await lite.buildTransaction()
            .addInstruction(await payout.getInstruction(cfg))
            .sendTransaction({ payer: checkerOwner });
        expect(payoutResult.logs).toBeDefined();

        // Verify all account states after payout
        const currentPeriod = getCurrentPeriod();
        await verifyFlexlockTokensAccount(lite, checkerOwner.address, currentPeriod, BigInt(mockedRewards));
        await verifyGlobalRewardsReset(lite, checkerIndex);

        // Verify pending_rewards decreased and lifetime_rewards unchanged
        const globalRewards = await getGlobalRewards(lite);
        expect(globalRewards.pending_rewards).toBe(0n); // Should be 0 after payout
        expect(globalRewards.lifetime_rewards).toBe(mockedRewards); // Should remain unchanged
    });

    it('should fail when trying to payout with zero rewards', async () => {
        const payout = new PayoutCheckerRewards({
            signer: checkerOwner.address,
            checker_license: checkerLicense,
        });

        // Should fail with insufficient funds error
        const cfg = await getRewardsVault(lite);
        await expect(async () => {
            return lite.buildTransaction()
                .addInstruction(await payout.getInstruction(cfg))
                .sendTransaction({ payer: checkerOwner });
        }).rejects.toThrow("Transaction failed");
    });

    it('should fail when trying to payout rewards for someone else', async () => {
        const mockedRewards = 4_000n;
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
        const cfg = await getRewardsVault(lite);
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

        const mockedRewards = 6_000n;
        const checkerIndex = checkerLicese.index;

        // Test 1: Owner should be able to payout
        await setMockedRewardsInGlobalRewards(lite, checkerIndex, mockedRewards);

        const currentPeriod = getCurrentPeriod();

        const payoutByOwner = new PayoutCheckerRewards({
            signer: checkerOwner.address, // Owner trying to payout
            checker_license: checkerLicese,
        });

        const cfg = await getRewardsVault(lite);
        const ownerPayoutResult = await lite.buildTransaction()
            .addInstruction(await payoutByOwner.getInstruction(cfg))
            .sendTransaction({ payer: checkerOwner });
        expect(ownerPayoutResult.logs).toBeDefined();

        // Verify the owner payout worked and balance was reset
        await verifyFlexlockTokensAccount(lite, checkerOwner.address, currentPeriod, BigInt(mockedRewards));
        await verifyGlobalRewardsReset(lite, checkerIndex);

        // Test 2: Set up rewards again and test delegate payout
        const additionalRewards = 3_000n;
        await setMockedRewardsInGlobalRewards(lite, checkerIndex, additionalRewards);

        const payoutByDelegate = new PayoutCheckerRewards({
            signer: delegate.address, // Delegate trying to payout
            checker_license: checkerLicese,
        });

        const cfg2 = await getRewardsVault(lite);
        const delegatePayoutResult = await lite.buildTransaction()
            .addInstruction(await payoutByDelegate.getInstruction(cfg2))
            .sendTransaction({ payer: delegate });
        expect(delegatePayoutResult.logs).toBeDefined();

        // Verify the delegate payout worked
        // IMPORTANT: Even though delegate executed the payout, flexlock tokens should be owned by the license owner
        // Since this is the same period, tokens should be accumulated in the same PDA
        await verifyFlexlockTokensAccount(lite, checkerOwner.address, currentPeriod, BigInt(mockedRewards + additionalRewards));
        await verifyGlobalRewardsReset(lite, checkerIndex);

        // Additional verification: Ensure delegate does NOT own any flexlock tokens
        await verifyNoFlexlockTokensForAddress(lite, delegate.address, currentPeriod);
    });

    it('should accumulate rewards in same flexlock tokens account for multiple checkers with same owner in the same period', async () => {
        // Create a single owner and mint two licenses to that owner
        const singleOwner = await lite.generateKeyPair();
        await lite.airdrop(singleOwner, 5);

        // Mint two licenses to the same owner
        const checker1License = await lite.mintLicense({ creator: authority, to: singleOwner });
        const checker2License = await lite.mintLicense({ creator: authority, to: singleOwner });

        // Activate both checkers
        await activateChecker({ lite, signer: singleOwner, lic: checker1License, delegate: singleOwner.address });
        await activateChecker({ lite, signer: singleOwner, lic: checker2License, delegate: singleOwner.address });

        const rewards1 = 3_000n;
        const rewards2 = 2_000n;
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

        const cfg = await getRewardsVault(lite);
        const payout1Result = await lite.buildTransaction()
            .addInstruction(await payout1.getInstruction(cfg))
            .sendTransaction({ payer: singleOwner });
        expect(payout1Result.logs).toBeDefined();
        expect(payout1Result.logs?.some(log => log.includes("Created new FlexlockTokens account"))).toBe(true); // First time, should create account

        // Verify first payout created flexlock tokens account with first reward amount
        await verifyFlexlockTokensAccount(lite, singleOwner.address, currentPeriod, BigInt(rewards1));

        // Verify pending_rewards decreased by first payout, lifetime_rewards accumulated
        let globalRewards = await getGlobalRewards(lite);
        expect(globalRewards.pending_rewards).toBe(rewards2); // Only second checker's rewards remain pending
        expect(globalRewards.lifetime_rewards).toBe(rewards1 + rewards2); // Both are in lifetime

        // Payout for second checker (same owner)
        const payout2 = new PayoutCheckerRewards({
            signer: singleOwner.address,
            checker_license: checker2License,
        });

        const cfg2 = await getRewardsVault(lite);
        const payout2Result = await lite.buildTransaction()
            .addInstruction(await payout2.getInstruction(cfg2))
            .sendTransaction({ payer: singleOwner });
        expect(payout2Result.logs).toBeDefined();
        expect(payout2Result.logs?.some(log => log.includes("Created new FlexlockTokens account"))).toBe(false); // Second time, should NOT create new account

        // Verify that the same flexlock tokens account now contains accumulated rewards
        await verifyFlexlockTokensAccount(lite, singleOwner.address, currentPeriod, BigInt(totalRewards));

        // Verify pending_rewards is now 0, lifetime_rewards still accumulated
        globalRewards = await getGlobalRewards(lite);
        expect(globalRewards.pending_rewards).toBe(0n); // All rewards paid out
        expect(globalRewards.lifetime_rewards).toBe(totalRewards); // Both are in lifetime

        // Verify both checkers' balances were reset
        await verifyGlobalRewardsReset(lite, checker1License.index);
        await verifyGlobalRewardsReset(lite, checker2License.index);
    });

    it('should create separate flexlock tokens accounts for different periods', async () => {
        // Create a checker
        const singleOwner = await lite.generateKeyPair();
        await lite.airdrop(singleOwner, 5);
        const checkerLicense = await lite.mintLicense({ creator: authority, to: singleOwner });
        await activateChecker({ lite, signer: singleOwner, lic: checkerLicense, delegate: singleOwner.address });

        const rewardsPeriod1 = 4_000n;
        const rewardsPeriod2 = 6_000n;
        
        // === PERIOD 1 ===
        const period1 = getCurrentPeriod();

        // Set rewards and payout for period 1
        await setMockedRewardsInGlobalRewards(lite, checkerLicense.index, rewardsPeriod1);

        const payout1 = new PayoutCheckerRewards({
            signer: singleOwner.address,
            checker_license: checkerLicense,
        });

        const cfg1 = await getRewardsVault(lite);
        const payout1Result = await lite.buildTransaction()
            .addInstruction(await payout1.getInstruction(cfg1))
            .sendTransaction({ payer: singleOwner });
        expect(payout1Result.logs).toBeDefined();

        // Verify period 1 flexlock tokens account
        await verifyFlexlockTokensAccount(lite, singleOwner.address, period1, BigInt(rewardsPeriod1));

        // === MOVE TO PERIOD 2 ===
        const period2 = period1 + 1;
        lite.goToPeriod(period2);

        // Set rewards and payout for period 2
        await setMockedRewardsInGlobalRewards(lite, checkerLicense.index, rewardsPeriod2);

        const payout2 = new PayoutCheckerRewards({
            signer: singleOwner.address,
            checker_license: checkerLicense,
        });

        const cfg = await getRewardsVault(lite);
        const payout2Result = await lite.buildTransaction()
            .addInstruction(await payout2.getInstruction(cfg, period2))
            .sendTransaction({ payer: singleOwner });
        expect(payout2Result.logs).toBeDefined();

        // Verify period 2 flexlock tokens account (separate from period 1)
        await verifyFlexlockTokensAccount(lite, singleOwner.address, period2, BigInt(rewardsPeriod2));

        // Verify period 1 flexlock tokens account still exists with original amount
        await verifyFlexlockTokensAccount(lite, singleOwner.address, period1, BigInt(rewardsPeriod1));

        // Verify pending_rewards is 0 and lifetime_rewards accumulated across both periods
        const globalRewards = await getGlobalRewards(lite);
        expect(globalRewards.pending_rewards).toBe(0n); // All rewards paid out
        expect(globalRewards.lifetime_rewards).toBe(rewardsPeriod1 + rewardsPeriod2); // Accumulated across periods

        // Verify that the PDAs are different for different periods
        const lockDays = cfg.data.lockDays;
        const checkerRewardsVaultPda = await CheckerRewardsVault.findPDA();

        const period1Pda = await FlexlockTokensAccount.findFlexlockTokensPDA(
            checkerRewardsVaultPda[0],
            singleOwner.address,
            period1,
            period1 + lockDays
        );
        const period2Pda = await FlexlockTokensAccount.findFlexlockTokensPDA(
            checkerRewardsVaultPda[0],
            singleOwner.address,
            period2,
            period2 + lockDays
        );
        expect(period1Pda[0]).not.toBe(period2Pda[0]); // Different PDA addresses
    });
});

// Helper functions
async function setMockedRewardsInGlobalRewards(
    lite: LiteDepin,
    checkerIndex: number,
    rewardsAmount: bigint
): Promise<void> {
    const globalRewardsPda = await GlobalRewardsAccount.findGlobalRewardsPDA();
    const current = lite.getAccountData(globalRewardsPda[0]);
    if (!current) throw new Error('GlobalRewards account not found');

    const globalRewards = GlobalRewardsAccount.deserializeFrom(current);
    globalRewards.checkers[checkerIndex] = rewardsAmount;
    globalRewards.pending_rewards += rewardsAmount;
    globalRewards.lifetime_rewards += rewardsAmount;
    const updated = GlobalRewardsAccount.serialize(globalRewards);
    lite.setAccountData(globalRewardsPda[0], updated);
}

async function getGlobalRewards(lite: LiteDepin): Promise<GlobalRewardsAccount> {
    const globalRewardsPda = await GlobalRewardsAccount.findGlobalRewardsPDA();
    const globalRewardsData = lite.getAccountData(globalRewardsPda[0]);
    if (!globalRewardsData) throw new Error('GlobalRewards account not found');
    return GlobalRewardsAccount.deserializeFrom(globalRewardsData);
}

async function verifyFlexlockTokensAccount(
    lite: LiteDepin,
    receiverAddress: Address,
    lockPeriod: number,
    expectedAmount: bigint
): Promise<void> {
    // Get the checker rewards lock days from config
    const cfg = await getRewardsVault(lite);
    const lockDays = cfg.data.lockDays;
    const unlockPeriod = lockPeriod + lockDays;

    // Sender is CheckerRewardsVault PDA
    const checkerRewardsVaultPda = await CheckerRewardsVault.findPDA();

    const flexlockTokensPda = await FlexlockTokensAccount.findFlexlockTokensPDA(
        checkerRewardsVaultPda[0], // sender
        receiverAddress, // receiver (checker owner)
        lockPeriod,
        unlockPeriod
    );
    const flexlockTokensAccountData = lite.getAccountData(flexlockTokensPda[0]);
    expect(flexlockTokensAccountData).not.toBeNull();

    const flexlockTokens = FlexlockTokensAccount.deserializeFrom(flexlockTokensAccountData!);
    expect(flexlockTokens.sender).toBe(checkerRewardsVaultPda[0]);
    expect(flexlockTokens.receiver).toBe(receiverAddress);
    expect(flexlockTokens.amount).toBe(expectedAmount);
    expect(flexlockTokens.rentReceiver).toBe(receiverAddress); // Rent goes to checker owner
}

async function verifyGlobalRewardsReset(
    lite: LiteDepin,
    checkerIndex: number
): Promise<void> {
    const globalRewardsPda = await GlobalRewardsAccount.findGlobalRewardsPDA();
    const globalRewardsData = lite.getAccountData(globalRewardsPda[0]);
    expect(globalRewardsData).not.toBeNull();

    const globalRewards = GlobalRewardsAccount.deserializeFrom(globalRewardsData!);
    expect(globalRewards.checkers[checkerIndex]).toBe(0n);
}

async function verifyNoFlexlockTokensForAddress(
    lite: LiteDepin,
    address: Address,
    lockPeriod: number
): Promise<void> {
    // Get the checker rewards lock days from config
    const cfg = await getRewardsVault(lite);
    const lockDays = cfg.data.lockDays;
    const unlockPeriod = lockPeriod + lockDays;

    // Sender is CheckerRewardsVault PDA
    const checkerRewardsVaultPda = await CheckerRewardsVault.findPDA();

    const flexlockTokensPda = await FlexlockTokensAccount.findFlexlockTokensPDA(
        checkerRewardsVaultPda[0], // sender
        address, // receiver
        lockPeriod,
        unlockPeriod
    );
    const flexlockTokensAccountData = lite.getAccountData(flexlockTokensPda[0]);

    // The account should not exist (should be null) since no flexlock tokens were created for this address
    expect(flexlockTokensAccountData).toBeNull();
}

async function getRewardsVault(lite: LiteDepin): Promise<{ address: Address; data: CheckerRewardsVault }> {
    const cfg = await CheckerRewardsVault.readFromState(async (addr) => lite.getAccountData(addr));
    if (!cfg) throw new Error('CheckerRewardsVault not found');
    return cfg;
}
