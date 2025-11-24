import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { Address } from 'gill';
import { beforeEach, describe, expect, it } from 'vitest';

import { BMB_MINT, getCurrentPeriod, LockedTokensAccount, TreasuryAuthority, TreasuryStateAccount, Unlock } from '@beamable-network/depin';
import { standardNetworkSetup } from '../../helpers/bmb-utils.js';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';

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
        lite.goToPeriod(100);
        const lockPeriod = 99;

        // Mock locked tokens account with unlock period in the past
        await createMockedLockedTokensAccount(lite, tokenOwner.address, lockedAmount, 100, lockPeriod);

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

    it('should return rent to user when account is closed on unlock', async () => {
        const lockedAmount = 10_000n;
        lite.goToPeriod(100);
        const lockPeriod = 99;

        // Mock locked tokens account with unlock period in the past
        await createMockedLockedTokensAccount(lite, tokenOwner.address, lockedAmount, 100, lockPeriod);

        // Get the locked tokens PDA to check its rent
        const lockedTokensPda = await LockedTokensAccount.findLockedTokensPDA(tokenOwner.address, lockPeriod, 100);
        const lockedAccountBefore = lite.getAccount(lockedTokensPda[0]);
        expect(lockedAccountBefore).not.toBeNull();
        const rentAmount = lockedAccountBefore!.lamports;
        expect(rentAmount).toBeGreaterThan(0n);

        // Get initial SOL balance of owner
        const ownerAccountBefore = lite.getAccount(tokenOwner.address);
        const initialOwnerLamports = ownerAccountBefore?.lamports ?? 0;

        // Set current period to be after unlock period to avoid penalty
        lite.goToPeriod(105);

        const unlock = new Unlock({
            owner: tokenOwner.address,
            lock_period: lockPeriod,
            owner_bmb_token_account: tokenOwnerAtaAddress,
            unlock_period_for_address: 100,
        });

        // Execute unlock transaction
        await lite.buildTransaction()
            .addInstruction(await unlock.getInstruction())
            .sendTransaction({ payer: tokenOwner });

        // Verify account is closed
        const lockedAccountAfter = lite.getAccount(lockedTokensPda[0]);
        expect(lockedAccountAfter).toBeNull();

        // Verify rent was returned to owner (minus transaction fee)
        const ownerAccountAfter = lite.getAccount(tokenOwner.address);
        const finalOwnerLamports = ownerAccountAfter?.lamports ?? 0;

        // Owner's lamports should increase by at least the rent amount (minus fees)
        const lamportChange = finalOwnerLamports - initialOwnerLamports;
        expect(lamportChange).toBeGreaterThan(0);
    });

    it('should unlock tokens with penalty when unlocked early', async () => {
        const lockedAmount = 10_000n;
        lite.goToPeriod(100); // Set period to 100 for consistent test behavior
        const lockPeriod = lite.getPeriod();
        const lockDuration = 90; // 90 days lock period
        const unlockPeriod = 100 + lockDuration; // Will unlock at period 190

        // Mock locked tokens account
        await createMockedLockedTokensAccount(lite, tokenOwner.address, lockedAmount, unlockPeriod, lockPeriod);

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

        // Verify penalty was applied correctly (50% through lock period = 50% vested)
        expect(actualReceivedAmount).toBeLessThan(lockedAmount); // Should receive less than full amount
        expect(actualReceivedAmount).toBeGreaterThanOrEqual(lockedAmount / 2n); // Should receive at least 50%

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

    it('should fail to unlocked immediately', async () => {
        const lockedAmount = 10_000n;
        // Create locked tokens at period 100, then unlock immediately at period 100
        lite.goToPeriod(100);
        const lockPeriod = lite.getPeriod();
        const unlockPeriod = 190; // 90 days from period 100

        // Mock locked tokens account
        await createMockedLockedTokensAccount(lite, tokenOwner.address, lockedAmount, unlockPeriod, lockPeriod);

        // Stay at current period (same as lock period = immediate unlock = maximum penalty)
        const unlock = new Unlock({
            owner: tokenOwner.address,
            lock_period: lockPeriod,
            owner_bmb_token_account: tokenOwnerAtaAddress,
            unlock_period_for_address: unlockPeriod,
        });

        // Execute unlock transaction
        await expect(async () => lite.buildTransaction()
            .addInstruction(await unlock.getInstruction())
            .sendTransaction({ payer: tokenOwner }))
            .rejects.toThrow("Tokens can be unlocked next day after locking. Current period: 100, Lock period: 100");
    });

    it('should apply maximum penalty when unlocked immediately', async () => {
        const lockedAmount = 10_000n;
        // Create locked tokens at period 100, then unlock immediately at period 100
        lite.goToPeriod(100);
        const lockPeriod = lite.getPeriod();
        const unlockPeriod = 190; // 90 days from period 100

        // Mock locked tokens account
        await createMockedLockedTokensAccount(lite, tokenOwner.address, lockedAmount, unlockPeriod, lockPeriod);

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

        lite.goToPeriod(101); // Move to next period to allow unlock with max penalty

        // Execute unlock transaction
        const unlockResult = await lite.buildTransaction()
            .addInstruction(await unlock.getInstruction())
            .sendTransaction({ payer: tokenOwner });
        expect(unlockResult.logs).toBeDefined();

        // Verify owner received 1/90 of amount (linear vesting: 1 day elapsed out of 90)
        // vested_amount = (10000 * 1 + 45) / 90 = 111 (rounded)
        const finalOwnerBalance = await lite.getTokenBalance(BMB_MINT, tokenOwner.address);
        const receivedAmount = finalOwnerBalance - initialOwnerBalance;
        const expectedAmount = 111n; // (10000 * 1 + 45) / 90 = 111
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

    it('should strip decimals when calculating vested amounts', async () => {
        const lockedAmount = 10_000n;
        // Create locked tokens at period 100, then unlock immediately at period 100
        lite.goToPeriod(100);
        const lockPeriod = lite.getPeriod();
        const unlockPeriod = 190; // 90 days from period 100

        // Mock locked tokens account
        await createMockedLockedTokensAccount(lite, tokenOwner.address, lockedAmount, unlockPeriod, lockPeriod);

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

        lite.goToPeriod(108);

        // Execute unlock transaction
        const unlockResult = await lite.buildTransaction()
            .addInstruction(await unlock.getInstruction())
            .sendTransaction({ payer: tokenOwner });
        expect(unlockResult.logs).toBeDefined();

        // Verify owner received 8/90 of amount (linear vesting: 8 days elapsed out of 90)
        // vested_amount = (10000 * 8) / 90 = 888.88
        const finalOwnerBalance = await lite.getTokenBalance(BMB_MINT, tokenOwner.address);
        const receivedAmount = finalOwnerBalance - initialOwnerBalance;
        const expectedAmount = 888n; // (10000 * 8) / 90 = 888.88
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

    it('should fail when someone else tries to unlock tokens', async () => {
        const lockedAmount = 8_000n;
        const lockPeriod = lite.getPeriod() - 1;

        // Mock locked tokens account owned by tokenOwner
        await createMockedLockedTokensAccount(lite, tokenOwner.address, lockedAmount, 200, lockPeriod);

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
        await createMockedLockedTokensAccount(lite, tokenOwner.address, lockedAmount, 200, correctPeriod);

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

    it('should handle old format accounts with extra bytes (backwards compatibility)', async () => {
        const lockedAmount = 10_000n;
        lite.goToPeriod(100);
        const lockPeriod = 99;
        const unlockPeriod = 100;

        const lockedTokensPda = await LockedTokensAccount.findLockedTokensPDA(tokenOwner.address, lockPeriod, unlockPeriod);

        // Create account using new format, then extend with random bytes to simulate old larger account
        const lockedTokensAccount = new LockedTokensAccount({
            owner: tokenOwner.address,
            totalLocked: lockedAmount,
            lockPeriod,
            unlockPeriod,
        });
        const newFormatData = LockedTokensAccount.serialize(lockedTokensAccount);

        // Extend with 9 random bytes to simulate old 54-byte format (was 45 + 9 = 54)
        const oldFormatData = new Uint8Array(54);
        oldFormatData.set(newFormatData);
        oldFormatData.set([0x00, 0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE], newFormatData.length);

        // TEST 1: Verify SDK can deserialize old format data with trailing bytes
        const deserializedAccount = LockedTokensAccount.deserializeFrom(oldFormatData);
        expect(deserializedAccount.owner).toBe(tokenOwner.address);
        expect(deserializedAccount.totalLocked).toBe(lockedAmount);
        expect(deserializedAccount.lockPeriod).toBe(lockPeriod);
        expect(deserializedAccount.unlockPeriod).toBe(unlockPeriod);

        // TEST 2: Set old format account in ledger and verify program can unlock it
        lite.setAccountData(lockedTokensPda[0], oldFormatData, 54);
        await updateTreasuryStateLockedBalance(lite, lockedAmount);

        lite.goToPeriod(105);

        const unlock = new Unlock({
            owner: tokenOwner.address,
            lock_period: lockPeriod,
            owner_bmb_token_account: tokenOwnerAtaAddress,
            unlock_period_for_address: unlockPeriod,
        });

        const initialOwnerBalance = await lite.getTokenBalance(BMB_MINT, tokenOwner.address);

        // Execute unlock - this should work with the old format account
        const unlockResult = await lite.buildTransaction()
            .addInstruction(await unlock.getInstruction())
            .sendTransaction({ payer: tokenOwner });
        expect(unlockResult.logs).toBeDefined();

        // Verify unlock succeeded
        const finalOwnerBalance = await lite.getTokenBalance(BMB_MINT, tokenOwner.address);
        expect(finalOwnerBalance - initialOwnerBalance).toBe(lockedAmount);

        // Verify account is closed
        const accountAfter = lite.getAccount(lockedTokensPda[0]);
        expect(accountAfter).toBeNull();
    });
});

// Helper functions
async function createMockedLockedTokensAccount(
    lite: LiteDepin,
    owner: Address,
    totalLocked: bigint,
    unlockPeriod: number,
    lockPeriod: number,
): Promise<void> {
    const lockedTokensPda = await LockedTokensAccount.findLockedTokensPDA(owner, lockPeriod, unlockPeriod);

    // Create LockedTokensAccount instance
    const lockedTokensAccount = new LockedTokensAccount({
        owner,
        totalLocked,
        lockPeriod,
        unlockPeriod,
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
    const treasuryAuthorityPda = await TreasuryAuthority.findDepinTreasuryPDA();
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

    // Verify locked tokens account is closed
    await verifyAccountClosed(lite, owner, lockPeriod, unlockPeriod);
}

async function verifyAccountClosed(
    lite: LiteDepin,
    owner: Address,
    lockPeriod: number,
    unlockPeriod: number
): Promise<void> {
    const lockedTokensPda = await LockedTokensAccount.findLockedTokensPDA(owner, lockPeriod, unlockPeriod);
    const lockedTokensAccountData = lite.getAccountData(lockedTokensPda[0]);
    // Account should be closed (null/empty data) after unlock
    expect(lockedTokensAccountData).toBeNull();
}
