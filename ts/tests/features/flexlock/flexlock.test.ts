import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { Address } from 'gill';
import { beforeEach, describe, expect, it } from 'vitest';

import {
    BMB_MINT,
    FlexLock,
    FlexlockTokensAccount,
    FlexlockVaultAuthority,
    FlexUnlock,
    getCurrentPeriod,
    USDC_MINT
} from '@beamable-network/depin';
import { standardNetworkSetup } from '../../helpers/bmb-utils.js';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';

describe('FlexLock', async () => {
    let lite: LiteDepin;
    let authority: LiteKeyPair;
    let sender: LiteKeyPair;
    let receiver: LiteKeyPair;
    let attacker: LiteKeyPair;
    let senderAtaAddress: Address;
    let receiverAtaAddress: Address;
    let attackerAtaAddress: Address;

    beforeEach(async () => {
        lite = new LiteDepin();
        authority = await lite.generateKeyPair();
        sender = await lite.generateKeyPair();
        receiver = await lite.generateKeyPair();
        attacker = await lite.generateKeyPair();

        await standardNetworkSetup({ lite, signer: authority });
        await lite.airdrop(sender, 5);
        await lite.airdrop(receiver, 5);
        await lite.airdrop(attacker, 5);

        // Find ATAs
        const [senderAta] = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: sender.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        senderAtaAddress = senderAta;

        const [receiverAta] = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: receiver.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        receiverAtaAddress = receiverAta;

        const [attackerAta] = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: attacker.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        attackerAtaAddress = attackerAta;

        // Create ATAs
        const mintAmount = 100_000n * 1_000_000_000n;
        await lite.mintToken(BMB_MINT, sender.address, mintAmount, authority);
        await lite.mintToken(BMB_MINT, receiver.address, 0n, authority);
        await lite.mintToken(BMB_MINT, attacker.address, 0n, authority);

        // Create vault ATA
        const vaultAuthorityPda = await FlexlockVaultAuthority.findFlexlockVaultPDA();
        await lite.mintToken(BMB_MINT, vaultAuthorityPda[0], 0n, authority);

        lite.goToPeriod(getCurrentPeriod());
    });

    describe('Basic Functionality', () => {
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

    describe('Authorization Tests', () => {
        it('should fail when sender tries to unlock (only receiver can unlock)', async () => {
            const lockAmount = 5_000n * 1_000_000_000n;
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

            // Move to unlock period
            lite.goToPeriod(currentPeriod + lockDurationDays + 5);

            // Try to unlock as sender (use correct PDA but sender signs)
            const flexUnlock = new FlexUnlock({
                receiver: receiver.address, // Correct receiver for PDA
                sender: sender.address,
                receiver_bmb_token_account: receiverAtaAddress,
                sender_bmb_token_account: senderAtaAddress,
                lock_period: currentPeriod,
                unlock_period: unlockPeriod,
            });

            await expect(async () => {
                return lite.buildTransaction()
                    .addInstruction(await flexUnlock.getInstruction())
                    .sendTransaction({ payer: sender }); // But sender signs instead of receiver
            }).rejects.toThrow("Signature verification failed"); // Fails before reaching program
        });

        it('should fail when attacker tries to unlock tokens', async () => {
            const lockAmount = 5_000n * 1_000_000_000n;
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

            lite.goToPeriod(currentPeriod + lockDurationDays + 5);

            // Attacker tries to unlock (use correct PDA but attacker signs)
            const flexUnlock = new FlexUnlock({
                receiver: receiver.address, // Correct receiver for PDA
                sender: sender.address,
                receiver_bmb_token_account: receiverAtaAddress,
                sender_bmb_token_account: senderAtaAddress,
                lock_period: currentPeriod,
                unlock_period: unlockPeriod,
            });

            await expect(async () => {
                return lite.buildTransaction()
                    .addInstruction(await flexUnlock.getInstruction())
                    .sendTransaction({ payer: attacker }); // But attacker signs instead of receiver
            }).rejects.toThrow("Signature verification failed"); // Fails before reaching program
        });

        it('should fail when non-sender tries to lock tokens on behalf of sender', async () => {
            const lockAmount = 5_000n * 1_000_000_000n;
            const lockDurationDays = 30;

            lite.goToPeriod(100);
            const currentPeriod = lite.getPeriod();

            // Attacker tries to create lock with sender's tokens
            const flexLock = new FlexLock({
                sender: sender.address, // Claims to be sender
                receiver: attacker.address, // But receiver is attacker
                amount: lockAmount,
                lock_duration_days: lockDurationDays,
                sender_bmb_token_account: senderAtaAddress,
                current_period: currentPeriod,
            });

            // Should fail because attacker is not the sender signer
            await expect(async () => {
                return lite.buildTransaction()
                    .addInstruction(await flexLock.getInstruction())
                    .sendTransaction({ payer: attacker }); // Attacker signing
            }).rejects.toThrow();
        });
    });

    describe('Token Validation Tests', () => {
        it('should fail when trying to use non-BMB tokens (USDC)', async () => {
            // Create USDC token
            await lite.createToken(USDC_MINT, authority);
            const [senderUsdcAta] = await findAssociatedTokenPda({
                mint: USDC_MINT,
                owner: sender.address,
                tokenProgram: TOKEN_PROGRAM_ADDRESS,
            });
            await lite.mintToken(USDC_MINT, sender.address, 100_000n * 1_000_000n, authority);

            const vaultAuthorityPda = await FlexlockVaultAuthority.findFlexlockVaultPDA();
            await lite.mintToken(USDC_MINT, vaultAuthorityPda[0], 0n, authority);

            lite.goToPeriod(100);
            const currentPeriod = lite.getPeriod();

            // Try to lock USDC (should use BMB mint validation)
            const flexLock = new FlexLock({
                sender: sender.address,
                receiver: receiver.address,
                amount: 1000n * 1_000_000n,
                lock_duration_days: 30,
                sender_bmb_token_account: senderUsdcAta, // Using USDC ATA instead of BMB
                current_period: currentPeriod,
            });

            await expect(async () => {
                return lite.buildTransaction()
                    .addInstruction(await flexLock.getInstruction())
                    .sendTransaction({ payer: sender });
            }).rejects.toThrow(); // Should fail BMB mint validation
        });
    });

    describe('Account Substitution Tests', () => {
        it('should fail when trying to redirect penalty to attacker account', async () => {
            const lockAmount = 10_000n * 1_000_000_000n;
            const lockDurationDays = 90;

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

            // Move to halfway point
            lite.goToPeriod(currentPeriod + Math.floor(lockDurationDays / 2));

            // Try to unlock but redirect sender's penalty to attacker
            const flexUnlock = new FlexUnlock({
                receiver: receiver.address,
                sender: sender.address,
                receiver_bmb_token_account: receiverAtaAddress,
                sender_bmb_token_account: attackerAtaAddress, // Trying to steal penalty
                lock_period: currentPeriod,
                unlock_period: unlockPeriod,
            });

            // Should fail validation - sender ATA must match FlexlockTokens sender
            await expect(async () => {
                return lite.buildTransaction()
                    .addInstruction(await flexUnlock.getInstruction())
                    .sendTransaction({ payer: receiver });
            }).rejects.toThrow(); // Should fail ATA validation
        });

        it('should fail when trying to redirect vested tokens to attacker account', async () => {
            const lockAmount = 10_000n * 1_000_000_000n;
            const lockDurationDays = 90;

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

            lite.goToPeriod(currentPeriod + lockDurationDays + 5);

            // Try to unlock but redirect receiver's tokens to attacker
            const flexUnlock = new FlexUnlock({
                receiver: receiver.address,
                sender: sender.address,
                receiver_bmb_token_account: attackerAtaAddress, // Trying to steal tokens
                sender_bmb_token_account: senderAtaAddress,
                lock_period: currentPeriod,
                unlock_period: unlockPeriod,
            });

            // Should fail validation - receiver ATA must match FlexlockTokens receiver
            await expect(async () => {
                return lite.buildTransaction()
                    .addInstruction(await flexUnlock.getInstruction())
                    .sendTransaction({ payer: receiver });
            }).rejects.toThrow(); // Should fail ATA validation
        });
    });

    describe('Double-Unlock Prevention Tests', () => {
        it('should fail when trying to unlock the same tokens twice', async () => {
            const lockAmount = 5_000n * 1_000_000_000n;
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

            lite.goToPeriod(currentPeriod + lockDurationDays + 5);

            // First unlock (should succeed)
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

            // Verify account is closed
            const flexlockTokensPda = await FlexlockTokensAccount.findFlexlockTokensPDA(
                sender.address,
                receiver.address,
                currentPeriod,
                unlockPeriod
            );
            const accountData = lite.getAccountData(flexlockTokensPda[0]);
            expect(accountData).toBeNull();

            // Try to unlock again (should fail - account closed)
            await expect(async () => {
                return lite.buildTransaction()
                    .addInstruction(await flexUnlock.getInstruction())
                    .sendTransaction({ payer: receiver });
            }).rejects.toThrow(); // FlexlockTokens account does not exist
        });
    });

    describe('PDA Manipulation Tests', () => {
        it('should fail when using wrong lock period in PDA derivation', async () => {
            const lockAmount = 5_000n * 1_000_000_000n;
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

            lite.goToPeriod(currentPeriod + lockDurationDays + 5);

            // Try to unlock with wrong lock period
            const flexUnlock = new FlexUnlock({
                receiver: receiver.address,
                sender: sender.address,
                receiver_bmb_token_account: receiverAtaAddress,
                sender_bmb_token_account: senderAtaAddress,
                lock_period: currentPeriod - 5, // Wrong period!
                unlock_period: unlockPeriod,
            });

            await expect(async () => {
                return lite.buildTransaction()
                    .addInstruction(await flexUnlock.getInstruction())
                    .sendTransaction({ payer: receiver });
            }).rejects.toThrow(); // Wrong PDA - account doesn't exist
        });

        it('should fail when using wrong unlock period in PDA derivation', async () => {
            const lockAmount = 5_000n * 1_000_000_000n;
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

            lite.goToPeriod(currentPeriod + lockDurationDays + 5);

            // Try to unlock with wrong unlock period
            const flexUnlock = new FlexUnlock({
                receiver: receiver.address,
                sender: sender.address,
                receiver_bmb_token_account: receiverAtaAddress,
                sender_bmb_token_account: senderAtaAddress,
                lock_period: currentPeriod,
                unlock_period: unlockPeriod + 10, // Wrong period!
            });

            await expect(async () => {
                return lite.buildTransaction()
                    .addInstruction(await flexUnlock.getInstruction())
                    .sendTransaction({ payer: receiver });
            }).rejects.toThrow(); // Wrong PDA - account doesn't exist
        });
    });

    describe('Rent Extraction Tests', () => {
        it('should return rent to sender, not receiver or attacker', async () => {
            const lockAmount = 5_000n * 1_000_000_000n;
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

            // Get FlexlockTokens PDA rent
            const flexlockTokensPda = await FlexlockTokensAccount.findFlexlockTokensPDA(
                sender.address,
                receiver.address,
                currentPeriod,
                unlockPeriod
            );
            const accountBefore = lite.getAccount(flexlockTokensPda[0]);
            expect(accountBefore).not.toBeNull();
            const rentAmount = accountBefore!.lamports;

            // Get initial SOL balances
            const senderSolBefore = lite.getAccount(sender.address)?.lamports ?? 0;
            const receiverSolBefore = lite.getAccount(receiver.address)?.lamports ?? 0;

            lite.goToPeriod(currentPeriod + lockDurationDays + 5);

            // Unlock
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

            // Get final SOL balances
            const senderSolAfter = lite.getAccount(sender.address)?.lamports ?? 0;
            const receiverSolAfter = lite.getAccount(receiver.address)?.lamports ?? 0;

            // Sender should receive rent back
            expect(senderSolAfter).toBeGreaterThan(senderSolBefore);
            const senderGain = senderSolAfter - senderSolBefore;
            expect(senderGain).toBe(rentAmount);

            // Receiver should only pay transaction fee (SOL decreases)
            expect(receiverSolAfter).toBeLessThan(receiverSolBefore);
        });
    });

    describe('Invalid Amount Tests', () => {
        it('should fail when trying to lock zero tokens', async () => {
            lite.goToPeriod(100);
            const currentPeriod = lite.getPeriod();

            const flexLock = new FlexLock({
                sender: sender.address,
                receiver: receiver.address,
                amount: 0n, // Zero amount
                lock_duration_days: 30,
                sender_bmb_token_account: senderAtaAddress,
                current_period: currentPeriod,
            });

            await expect(async () => {
                return lite.buildTransaction()
                    .addInstruction(await flexLock.getInstruction())
                    .sendTransaction({ payer: sender });
            }).rejects.toThrow("Amount must be greater than 0");
        });

        it('should fail when trying to lock more tokens than sender has', async () => {
            const senderBalance = await lite.getTokenBalance(BMB_MINT, sender.address);
            const excessiveAmount = senderBalance + 1_000_000_000n;

            lite.goToPeriod(100);
            const currentPeriod = lite.getPeriod();

            const flexLock = new FlexLock({
                sender: sender.address,
                receiver: receiver.address,
                amount: excessiveAmount,
                lock_duration_days: 30,
                sender_bmb_token_account: senderAtaAddress,
                current_period: currentPeriod,
            });

            await expect(async () => {
                return lite.buildTransaction()
                    .addInstruction(await flexLock.getInstruction())
                    .sendTransaction({ payer: sender });
            }).rejects.toThrow(); // Insufficient funds
        });
    });

    describe('Invalid Duration Tests', () => {
        it('should fail when lock duration is zero', async () => {
            lite.goToPeriod(100);
            const currentPeriod = lite.getPeriod();

            const flexLock = new FlexLock({
                sender: sender.address,
                receiver: receiver.address,
                amount: 1000n * 1_000_000_000n,
                lock_duration_days: 0, // Zero duration
                sender_bmb_token_account: senderAtaAddress,
                current_period: currentPeriod,
            });

            await expect(async () => {
                return lite.buildTransaction()
                    .addInstruction(await flexLock.getInstruction())
                    .sendTransaction({ payer: sender });
            }).rejects.toThrow("Invalid lock duration");
        });
    });
});

// Helper function
async function getVaultBalance(lite: LiteDepin): Promise<bigint> {
    const vaultAuthorityPda = await FlexlockVaultAuthority.findFlexlockVaultPDA();
    return lite.getTokenBalance(BMB_MINT, vaultAuthorityPda[0]);
}
