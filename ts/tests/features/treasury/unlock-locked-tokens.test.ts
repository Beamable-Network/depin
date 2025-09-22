import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { Address, none, some } from 'gill';
import { beforeEach, describe, expect, it } from 'vitest';

import { BMB_MINT, LockedTokensAccount, TreasuryAuthority, TreasuryStateAccount, Unlock } from '@beamable-network/depin';
import { standardNetworkSetup } from '../../helpers/bmb-utils.js';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';
import { getCurrentPeriod } from '@beamable-network/depin';

describe('Unlock locked tokens', async () => {
    let lite: LiteDepin;
    let authority: LiteKeyPair;
    let tokenOwner: LiteKeyPair;
    let tokenOwnerAtaAddress: Address;

    beforeEach(async () => {
        lite = new LiteDepin();
        authority = await lite.generateKeyPair();
        tokenOwner = await lite.generateKeyPair();

        await standardNetworkSetup({ lite, signer: authority });
        await lite.airdrop(tokenOwner, 5);

        // Find token owner's ATA address
        const [ataAddress] = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: tokenOwner.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        tokenOwnerAtaAddress = ataAddress;

        // Create the owner's ATA by minting some tokens to it first
        await lite.mintToken(BMB_MINT, tokenOwner.address, 0n, authority);

        lite.goToPeriod(getCurrentPeriod());
    });

    it('should unlock tokens with no penalty after unlock period', async () => {
        const lockedAmount = 10_000n;
        const lockPeriod = lite.getPeriod() - 1;;

        // Mock locked tokens account with unlock period in the past
        await createMockedLockedTokensAccount(lite, tokenOwner.address, lockedAmount, 100, lockPeriod, null);

        // Set current period to be after unlock period to avoid penalty
        lite.goToPeriod(105);

        const unlock = new Unlock({
            owner: tokenOwner.address,
            lock_period: lockPeriod,
            owner_bmb_token_account: tokenOwnerAtaAddress,
            unlock_period_for_address: 100,
        });

        // Get initial balances
        const initialOwnerBalance = await lite.getTokenBalance(BMB_MINT, tokenOwner.address);
        const initialTreasuryBalance = await getTreasuryBalance(lite);
        const initialTreasuryState = await getTreasuryState(lite);

        // Execute unlock transaction
        const unlockResult = await lite.buildTransaction()
            .addInstruction(await unlock.getInstruction())
            .sendTransaction({ payer: tokenOwner });
        expect(unlockResult.logs).toBeDefined();

        // Verify unlock results (no penalty - full amount received)
        await verifyUnlockResults(
            lite,
            tokenOwner.address,
            lockPeriod,
            100,
            lockedAmount,
            lockedAmount, // Expected received amount = full amount (no penalty)
            initialOwnerBalance,
            initialTreasuryBalance,
            initialTreasuryState
        );
    });

    it('should unlock tokens with penalty when unlocked early', async () => {
        const lockedAmount = 10_000n;
        const lockPeriod = lite.getPeriod() - 1;
        const lockDuration = 365; // 365 days lock period
        const unlockPeriod = 100 + lockDuration; // Will unlock at period 465

        // Mock locked tokens account
        await createMockedLockedTokensAccount(lite, tokenOwner.address, lockedAmount, unlockPeriod, lockPeriod, null);

        // Set current period to halfway through lock period (should have ~50% penalty)
        const currentPeriod = 100 + Math.floor(lockDuration / 2); // ~50% through lock period
        lite.goToPeriod(currentPeriod);

        const unlock = new Unlock({
            owner: tokenOwner.address,
            lock_period: lockPeriod,
            owner_bmb_token_account: tokenOwnerAtaAddress,
            unlock_period_for_address: unlockPeriod,
        });

        // Get initial balances
        const initialOwnerBalance = await lite.getTokenBalance(BMB_MINT, tokenOwner.address);
        const initialTreasuryBalance = await getTreasuryBalance(lite);
        const initialTreasuryState = await getTreasuryState(lite);

        // Execute unlock transaction
        const unlockResult = await lite.buildTransaction()
            .addInstruction(await unlock.getInstruction())
            .sendTransaction({ payer: tokenOwner });
        expect(unlockResult.logs).toBeDefined();

        // Calculate expected amount after penalty (at halfway point, ~50% penalty)
        const finalOwnerBalance = await lite.getTokenBalance(BMB_MINT, tokenOwner.address);
        const actualReceivedAmount = finalOwnerBalance - initialOwnerBalance;

        // Verify penalty was applied correctly (~50% through lock period)
        expect(actualReceivedAmount).toBeLessThan(lockedAmount); // Should receive less than full amount
        expect(actualReceivedAmount).toBeGreaterThan(lockedAmount / 2n); // Should receive more than 50%

        // Verify all unlock results using the received amount
        await verifyUnlockResults(
            lite,
            tokenOwner.address,
            lockPeriod,
            unlockPeriod,
            lockedAmount,
            actualReceivedAmount,
            initialOwnerBalance,
            initialTreasuryBalance,
            initialTreasuryState
        );
    });

    it('should apply maximum penalty when unlocked immediately', async () => {
        const lockedAmount = 10_000n;
        // Create locked tokens at period 100, then unlock immediately at period 100
        lite.goToPeriod(100);
        const lockPeriod = lite.getPeriod();
        const unlockPeriod = 465; // 365 days from period 100

        // Mock locked tokens account
        await createMockedLockedTokensAccount(lite, tokenOwner.address, lockedAmount, unlockPeriod, lockPeriod, null);

        // Stay at current period (same as lock period = immediate unlock = maximum penalty)
        const unlock = new Unlock({
            owner: tokenOwner.address,
            lock_period: lockPeriod,
            owner_bmb_token_account: tokenOwnerAtaAddress,
            unlock_period_for_address: unlockPeriod,
        });

        // Get initial balances
        const initialOwnerBalance = await lite.getTokenBalance(BMB_MINT, tokenOwner.address);
        const initialTreasuryBalance = await getTreasuryBalance(lite);
        const initialTreasuryState = await getTreasuryState(lite);

        // Execute unlock transaction
        const unlockResult = await lite.buildTransaction()
            .addInstruction(await unlock.getInstruction())
            .sendTransaction({ payer: tokenOwner });
        expect(unlockResult.logs).toBeDefined();

        // Verify owner received only 10% (90% penalty for immediate unlock)
        const finalOwnerBalance = await lite.getTokenBalance(BMB_MINT, tokenOwner.address);
        const receivedAmount = finalOwnerBalance - initialOwnerBalance;
        const expectedAmount = lockedAmount / 10n; // 10% of original amount
        expect(receivedAmount).toBe(expectedAmount);

        // Verify all unlock results
        await verifyUnlockResults(
            lite,
            tokenOwner.address,
            lockPeriod,
            unlockPeriod,
            lockedAmount,
            expectedAmount,
            initialOwnerBalance,
            initialTreasuryBalance,
            initialTreasuryState
        );
    });

    it('should fail when trying to unlock non-existent locked tokens', async () => {
        const nonExistentPeriod = lite.getPeriod() - 1;

        const unlock = new Unlock({
            owner: tokenOwner.address,
            lock_period: nonExistentPeriod,
            owner_bmb_token_account: tokenOwnerAtaAddress,
        });

        // Should fail with uninitialized account error
        await expect(async () => {
            return lite.buildTransaction()
                .addInstruction(await unlock.getInstruction())
                .sendTransaction({ payer: tokenOwner });
        }).rejects.toThrow("Transaction failed");
    });

    it('should fail when trying to unlock already unlocked tokens', async () => {
        const lockedAmount = 5_000n;
        const lockPeriod = lite.getPeriod() - 1;
        const unlockTimestamp = lite.getTime();

        // Mock locked tokens account that's already been unlocked
        await createMockedLockedTokensAccount(lite, tokenOwner.address, lockedAmount, 200, lockPeriod, unlockTimestamp);

        lite.goToPeriod(105);

        const unlock = new Unlock({
            owner: tokenOwner.address,
            lock_period: lockPeriod,
            owner_bmb_token_account: tokenOwnerAtaAddress,
        });

        // Should fail because tokens were already unlocked
        await expect(async () => {
            return lite.buildTransaction()
                .addInstruction(await unlock.getInstruction())
                .sendTransaction({ payer: tokenOwner });
        }).rejects.toThrow("Transaction failed");
    });

    it('should fail when someone else tries to unlock tokens', async () => {
        const lockedAmount = 8_000n;
        const lockPeriod = lite.getPeriod() - 1;

        // Mock locked tokens account owned by tokenOwner
        await createMockedLockedTokensAccount(lite, tokenOwner.address, lockedAmount, 200, lockPeriod, null);

        // Create unauthorized user
        const unauthorizedUser = await lite.generateKeyPair();
        await lite.airdrop(unauthorizedUser, 5);

        lite.goToPeriod(105);

        const unlock = new Unlock({
            owner: tokenOwner.address, // Trying to unlock tokenOwner's tokens
            lock_period: lockPeriod,
            owner_bmb_token_account: tokenOwnerAtaAddress, // tokenOwner's ATA
        });

        // Should fail with missing required signature error
        await expect(async () => {
            return lite.buildTransaction()
                .addInstruction(await unlock.getInstruction())
                .sendTransaction({ payer: unauthorizedUser });
        }).rejects.toThrow("Signature verification failed");
    });

    it('should fail when PDA period does not match locked tokens', async () => {
        const lockedAmount = 7_000n;
        const correctPeriod = lite.getPeriod() - 1;
        const wrongPeriod = lite.getPeriod() - 5;

        // Mock locked tokens account with correct period
        await createMockedLockedTokensAccount(lite, tokenOwner.address, lockedAmount, 200, correctPeriod, null);

        lite.goToPeriod(105);

        // Try to unlock with wrong period (will generate wrong PDA)
        const unlock = new Unlock({
            owner: tokenOwner.address,
            lock_period: wrongPeriod, // Wrong period
            owner_bmb_token_account: tokenOwnerAtaAddress,
        });

        // Should fail because PDA won't match
        await expect(async () => {
            return lite.buildTransaction()
                .addInstruction(await unlock.getInstruction())
                .sendTransaction({ payer: tokenOwner });
        }).rejects.toThrow("Transaction failed");
    });
});

// Helper functions
async function createMockedLockedTokensAccount(
    lite: LiteDepin,
    owner: Address,
    totalLocked: bigint,
    unlockPeriod: number,
    lockPeriod: number,
    unlockedAt: bigint | null
): Promise<void> {
    const lockedTokensPda = await LockedTokensAccount.findLockedTokensPDA(owner, lockPeriod, unlockPeriod);

    // Create LockedTokensAccount instance
    const lockedTokensAccount = new LockedTokensAccount({
        owner,
        totalLocked,
        lockPeriod,
        unlockPeriod,
        unlockedAt: unlockedAt == null ? none() : some(unlockedAt)
    });

    // Serialize the account data
    const accountData = LockedTokensAccount.serialize(lockedTokensAccount);

    lite.setAccountData(lockedTokensPda[0], accountData, LockedTokensAccount.calculateAccountSize());

    // Update treasury state to reflect the locked tokens
    await updateTreasuryStateLockedBalance(lite, totalLocked);
}

async function updateTreasuryStateLockedBalance(lite: LiteDepin, additionalLocked: bigint): Promise<void> {
    const treasuryStatePda = await TreasuryStateAccount.findTreasuryStatePDA();

    // Get current treasury state
    const currentData = lite.getAccountData(treasuryStatePda[0]);
    let treasuryState: TreasuryStateAccount;

    if (currentData) {
        treasuryState = TreasuryStateAccount.deserializeFrom(currentData);
        treasuryState.lockedBalance += additionalLocked;
    } else {
        treasuryState = new TreasuryStateAccount({ lockedBalance: additionalLocked });
    }

    // Serialize and update the account
    const accountData = TreasuryStateAccount.serialize(treasuryState);
    lite.setAccountData(treasuryStatePda[0], accountData, TreasuryStateAccount.calculateAccountSize());
}

async function getTreasuryBalance(lite: LiteDepin): Promise<bigint> {
    const treasuryAuthorityPda = await TreasuryAuthority.findTreasuryPDA();
    return lite.getTokenBalance(BMB_MINT, treasuryAuthorityPda[0]);
}

async function getTreasuryState(lite: LiteDepin): Promise<TreasuryStateAccount> {
    const treasuryStatePda = await TreasuryStateAccount.findTreasuryStatePDA();
    const treasuryStateAccountData = lite.getAccountData(treasuryStatePda[0]);
    return TreasuryStateAccount.deserializeFrom(treasuryStateAccountData!);
}

async function verifyUnlockResults(
    lite: LiteDepin,
    owner: Address,
    lockPeriod: number,
    unlockPeriod: number,
    lockedAmount: bigint,
    expectedReceivedAmount: bigint,
    initialOwnerBalance: bigint,
    initialTreasuryBalance: bigint,
    initialTreasuryState: TreasuryStateAccount
): Promise<void> {
    // Verify owner received expected amount
    const finalOwnerBalance = await lite.getTokenBalance(BMB_MINT, owner);
    const actualReceivedAmount = finalOwnerBalance - initialOwnerBalance;
    expect(actualReceivedAmount).toBe(expectedReceivedAmount);

    // Verify treasury balance decreased by received amount (penalty stays in treasury)
    const finalTreasuryBalance = await getTreasuryBalance(lite);
    expect(initialTreasuryBalance - finalTreasuryBalance).toBe(expectedReceivedAmount);

    // Verify treasury state locked balance decreased by full locked amount
    const finalTreasuryState = await getTreasuryState(lite);
    expect(initialTreasuryState.lockedBalance - finalTreasuryState.lockedBalance).toBe(lockedAmount);

    // Verify locked tokens account is marked as unlocked
    await verifyTokensMarkedAsUnlocked(lite, owner, lockPeriod, unlockPeriod);
}

async function verifyTokensMarkedAsUnlocked(
    lite: LiteDepin,
    owner: Address,
    lockPeriod: number,
    unlockPeriod: number
): Promise<void> {
    const lockedTokensPda = await LockedTokensAccount.findLockedTokensPDA(owner, lockPeriod, unlockPeriod);
    const lockedTokensAccountData = lite.getAccountData(lockedTokensPda[0]);
    expect(lockedTokensAccountData).not.toBeNull();

    const lockedTokens = LockedTokensAccount.deserializeFrom(lockedTokensAccountData!);
    expect(lockedTokens.unlockedAt).not.toBeNull();
}
