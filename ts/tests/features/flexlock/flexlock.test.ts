import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { Address } from 'gill';
import { beforeEach, describe, expect, it } from 'vitest';

import {
    BMB_MINT,
    getCurrentPeriod,
    FlexLock,
    FlexUnlock,
    FlexlockTokensAccount,
    FlexlockVaultAuthority
} from '@beamable-network/depin';
import { standardNetworkSetup } from '../../helpers/bmb-utils.js';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';

describe('Basic FlexLock and FlexUnlock', async () => {
    let lite: LiteDepin;
    let authority: LiteKeyPair;
    let sender: LiteKeyPair;
    let receiver: LiteKeyPair;
    let senderAtaAddress: Address;
    let receiverAtaAddress: Address;

    beforeEach(async () => {
        lite = new LiteDepin();
        authority = await lite.generateKeyPair();
        sender = await lite.generateKeyPair();
        receiver = await lite.generateKeyPair();

        await standardNetworkSetup({ lite, signer: authority });
        await lite.airdrop(sender, 5);
        await lite.airdrop(receiver, 5);

        // Find sender's ATA address
        const [senderAta] = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: sender.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        senderAtaAddress = senderAta;

        // Find receiver's ATA address
        const [receiverAta] = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: receiver.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        receiverAtaAddress = receiverAta;

        // Create sender's ATA by minting tokens
        const mintAmount = 100_000n * 1_000_000_000n; // 100,000 BMB
        await lite.mintToken(BMB_MINT, sender.address, mintAmount, authority);

        // Create receiver's ATA (mint 0 tokens just to initialize)
        await lite.mintToken(BMB_MINT, receiver.address, 0n, authority);

        // Create vault ATA
        const vaultAuthorityPda = await FlexlockVaultAuthority.findFlexlockVaultPDA();
        await lite.mintToken(BMB_MINT, vaultAuthorityPda[0], 0n, authority);

        lite.goToPeriod(getCurrentPeriod());
    });

    it('should lock and unlock tokens with no penalty after unlock period', async () => {
        const lockAmount = 10_000n * 1_000_000_000n; // 10,000 BMB
        const lockDurationDays = 90; // 90 days

        lite.goToPeriod(100);
        const currentPeriod = lite.getPeriod();

        // Get initial balances
        const initialSenderBalance = await lite.getTokenBalance(BMB_MINT, sender.address);
        const initialReceiverBalance = await lite.getTokenBalance(BMB_MINT, receiver.address);
        const initialVaultBalance = await getVaultBalance(lite);

        expect(initialSenderBalance).toBeGreaterThanOrEqual(lockAmount);

        // STEP 1: Lock tokens
        const flexLock = new FlexLock({
            sender: sender.address,
            receiver: receiver.address,
            amount: lockAmount,
            lock_duration_days: lockDurationDays,
            sender_bmb_token_account: senderAtaAddress,
            current_period: currentPeriod,
        });

        const lockResult = await lite.buildTransaction()
            .addInstruction(await flexLock.getInstruction())
            .sendTransaction({ payer: sender });

        expect(lockResult.logs).toBeDefined();

        // Verify sender's balance decreased
        const senderBalanceAfterLock = await lite.getTokenBalance(BMB_MINT, sender.address);
        expect(initialSenderBalance - senderBalanceAfterLock).toBe(lockAmount);

        // Verify vault balance increased
        const vaultBalanceAfterLock = await getVaultBalance(lite);
        expect(vaultBalanceAfterLock - initialVaultBalance).toBe(lockAmount);

        // Verify FlexlockTokens account was created
        const unlockPeriod = currentPeriod + lockDurationDays;
        const flexlockTokensPda = await FlexlockTokensAccount.findFlexlockTokensPDA(
            sender.address,
            receiver.address,
            currentPeriod,
            unlockPeriod
        );
        const flexlockAccountData = lite.getAccountData(flexlockTokensPda[0]);
        expect(flexlockAccountData).not.toBeNull();

        const flexlockAccount = FlexlockTokensAccount.deserializeFrom(flexlockAccountData!);
        expect(flexlockAccount.sender).toBe(sender.address);
        expect(flexlockAccount.receiver).toBe(receiver.address);
        expect(flexlockAccount.amount).toBe(lockAmount);
        expect(flexlockAccount.lockPeriod).toBe(currentPeriod);
        expect(flexlockAccount.unlockPeriod).toBe(unlockPeriod);

        // STEP 2: Move forward in time past unlock period
        lite.goToPeriod(currentPeriod + lockDurationDays + 10); // 10 days after unlock period

        // STEP 3: Unlock tokens as receiver
        const flexUnlock = new FlexUnlock({
            receiver: receiver.address,
            sender: sender.address,
            receiver_bmb_token_account: receiverAtaAddress,
            sender_bmb_token_account: senderAtaAddress,
            lock_period: currentPeriod,
            unlock_period: unlockPeriod,
        });

        const unlockResult = await lite.buildTransaction()
            .addInstruction(await flexUnlock.getInstruction())
            .sendTransaction({ payer: receiver });

        expect(unlockResult.logs).toBeDefined();

        // Verify receiver received full amount (no penalty)
        const receiverBalanceAfterUnlock = await lite.getTokenBalance(BMB_MINT, receiver.address);
        expect(receiverBalanceAfterUnlock - initialReceiverBalance).toBe(lockAmount);

        // Verify vault balance decreased by lock amount
        const vaultBalanceAfterUnlock = await getVaultBalance(lite);
        expect(vaultBalanceAfterLock - vaultBalanceAfterUnlock).toBe(lockAmount);

        // Verify sender's balance remained the same (no penalty returned)
        const senderBalanceAfterUnlock = await lite.getTokenBalance(BMB_MINT, sender.address);
        expect(senderBalanceAfterUnlock).toBe(senderBalanceAfterLock);

        // Verify FlexlockTokens account was closed
        const flexlockAccountAfterUnlock = lite.getAccountData(flexlockTokensPda[0]);
        expect(flexlockAccountAfterUnlock).toBeNull();
    });

    it('should unlock tokens with penalty when unlocked early', async () => {
        const lockAmount = 10_000n * 1_000_000_000n; // 10,000 BMB
        const lockDurationDays = 90; // 90 days

        lite.goToPeriod(100);
        const currentPeriod = lite.getPeriod();
        const unlockPeriod = currentPeriod + lockDurationDays;

        // Get initial balances
        const initialSenderBalance = await lite.getTokenBalance(BMB_MINT, sender.address);
        const initialReceiverBalance = await lite.getTokenBalance(BMB_MINT, receiver.address);

        // STEP 1: Lock tokens
        const flexLock = new FlexLock({
            sender: sender.address,
            receiver: receiver.address,
            amount: lockAmount,
            lock_duration_days: lockDurationDays,
            sender_bmb_token_account: senderAtaAddress,
            current_period: currentPeriod,
        });

        await lite.buildTransaction()
            .addInstruction(await flexLock.getInstruction())
            .sendTransaction({ payer: sender });

        const senderBalanceAfterLock = await lite.getTokenBalance(BMB_MINT, sender.address);

        // STEP 2: Move forward to halfway point (50% vested)
        const halfwayPeriod = currentPeriod + Math.floor(lockDurationDays / 2);
        lite.goToPeriod(halfwayPeriod);

        // STEP 3: Unlock tokens early as receiver
        const flexUnlock = new FlexUnlock({
            receiver: receiver.address,
            sender: sender.address,
            receiver_bmb_token_account: receiverAtaAddress,
            sender_bmb_token_account: senderAtaAddress,
            lock_period: currentPeriod,
            unlock_period: unlockPeriod,
        });

        await lite.buildTransaction()
            .addInstruction(await flexUnlock.getInstruction())
            .sendTransaction({ payer: receiver });

        // Verify receiver got approximately 50% (vested amount)
        const receiverBalanceAfterUnlock = await lite.getTokenBalance(BMB_MINT, receiver.address);
        const receiverGained = receiverBalanceAfterUnlock - initialReceiverBalance;

        // At halfway point, should get approximately 50% of locked amount
        const expectedVested = lockAmount / 2n;
        expect(receiverGained).toBeGreaterThanOrEqual(expectedVested - 1_000_000_000n); // Allow 1 BMB tolerance
        expect(receiverGained).toBeLessThanOrEqual(expectedVested + 1_000_000_000n);

        // Verify sender got back approximately 50% (penalty)
        const senderBalanceAfterUnlock = await lite.getTokenBalance(BMB_MINT, sender.address);
        const senderGained = senderBalanceAfterUnlock - senderBalanceAfterLock;

        const expectedPenalty = lockAmount / 2n;
        expect(senderGained).toBeGreaterThanOrEqual(expectedPenalty - 1_000_000_000n); // Allow 1 BMB tolerance
        expect(senderGained).toBeLessThanOrEqual(expectedPenalty + 1_000_000_000n);

        // Verify total returned equals locked amount (vested + penalty)
        expect(receiverGained + senderGained).toBe(lockAmount);
    });

    it('should fail to unlock on the same day as lock', async () => {
        const lockAmount = 5_000n * 1_000_000_000n; // 5,000 BMB
        const lockDurationDays = 30;

        lite.goToPeriod(100);
        const currentPeriod = lite.getPeriod();
        const unlockPeriod = currentPeriod + lockDurationDays;

        // Lock tokens
        const flexLock = new FlexLock({
            sender: sender.address,
            receiver: receiver.address,
            amount: lockAmount,
            lock_duration_days: lockDurationDays,
            sender_bmb_token_account: senderAtaAddress,
            current_period: currentPeriod,
        });

        await lite.buildTransaction()
            .addInstruction(await flexLock.getInstruction())
            .sendTransaction({ payer: sender });

        // Try to unlock immediately (same period)
        const flexUnlock = new FlexUnlock({
            receiver: receiver.address,
            sender: sender.address,
            receiver_bmb_token_account: receiverAtaAddress,
            sender_bmb_token_account: senderAtaAddress,
            lock_period: currentPeriod,
            unlock_period: unlockPeriod,
        });

        // Should fail
        await expect(async () => {
            return lite.buildTransaction()
                .addInstruction(await flexUnlock.getInstruction())
                .sendTransaction({ payer: receiver });
        }).rejects.toThrow("Tokens can be unlocked next day after locking");
    });
});

// Helper function
async function getVaultBalance(lite: LiteDepin): Promise<bigint> {
    const vaultAuthorityPda = await FlexlockVaultAuthority.findFlexlockVaultPDA();
    return lite.getTokenBalance(BMB_MINT, vaultAuthorityPda[0]);
}
