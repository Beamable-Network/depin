import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { Address } from 'gill';
import { beforeEach, describe, expect, it } from 'vitest';

import {
    AddStake,
    BMB_MINT,
    ClaimRewards,
    DepositRevenue,
    InitializeOffer,
    OfferBookAccount,
    OptOutRollover,
    Stake,
    Unstake,
    USDC_MINT,
    UserStakePositionAccount
} from '@beamable-network/depin';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';

describe('Rev-Share Basic Flow', async () => {
    let lite: LiteDepin;
    let admin: LiteKeyPair;
    let userAlice: LiteKeyPair;
    let userBob: LiteKeyPair;
    let aliceBmbAta: Address;
    let aliceUsdcAta: Address;
    let bobBmbAta: Address;
    let bobUsdcAta: Address;

    beforeEach(async () => {
        lite = new LiteDepin();
        admin = await lite.generateKeyPair();
        userAlice = await lite.generateKeyPair();
        userBob = await lite.generateKeyPair();

        // Airdrop SOL for transaction fees
        await lite.airdrop(admin, 10);
        await lite.airdrop(userAlice, 10);
        await lite.airdrop(userBob, 10);

        // Find ATAs
        const [aliceBmb] = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: userAlice.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        aliceBmbAta = aliceBmb;

        const [aliceUsdc] = await findAssociatedTokenPda({
            mint: USDC_MINT,
            owner: userAlice.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        aliceUsdcAta = aliceUsdc;

        const [bobBmb] = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: userBob.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        bobBmbAta = bobBmb;

        const [bobUsdc] = await findAssociatedTokenPda({
            mint: USDC_MINT,
            owner: userBob.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        bobUsdcAta = bobUsdc;

        // Create token mints
        await lite.createToken(BMB_MINT, admin);
        await lite.createToken(USDC_MINT, admin);

        // Mint tokens to users
        await lite.mintToken(BMB_MINT, userAlice.address, 10_000n, admin);
        await lite.mintToken(BMB_MINT, userBob.address, 5_000n, admin);
        await lite.mintToken(USDC_MINT, userAlice.address, 0n, admin);
        await lite.mintToken(USDC_MINT, userBob.address, 0n, admin);
    });

    it('should complete full rev-share flow: initialize -> stake -> deposit -> claim', async () => {
        // ========== 1. Initialize first offer ==========
        const now = BigInt(Math.floor(Date.now() / 1000));
        const startTime = now + 10n; // Must be in the future
        const endTime = now + 86400n * 30n; // 30 days

        const initOffer = new InitializeOffer({
            admin: admin.address,
            payer: admin.address,
            offer_id: 1,
            start_time: startTime,
            end_time: endTime,
            revenue_percentage: 10000, // 100% for testing (10000 basis points = 100%)
        });

        const initResult = await lite.buildTransaction()
            .addInstruction(await initOffer.getInstruction())
            .sendTransaction({ payer: admin });

        // Advance time to be within the offer period
        lite.setTime(startTime + 1n);

        expect(initResult.logs).toBeDefined();

        // Verify OfferBook was created
        const offerBookPda = await OfferBookAccount.findOfferBookPDA();
        const offerBook = await getOfferBook(lite);
        expect(offerBook).toBeDefined();
        expect(offerBook.offers.length).toBe(1);
        expect(offerBook.getLastOffer()?.offerId).toBe(1);

        // Verify Offer was created
        const offer1 = await getOffer(lite, 1);
        expect(offer1).toBeDefined();
        expect(offer1.offerId).toBe(1);
        expect(offer1.totalStaked).toBe(0n);
        expect(offer1.collectedUsdc).toBe(0n);

        // ========== 2. Alice stakes 1000 BMB ==========
        const aliceStakeAmount = 1_000n;
        const aliceStake = new Stake({
            user: userAlice.address,
            payer: userAlice.address,
            amount: aliceStakeAmount,
            user_bmb_token_account: aliceBmbAta,
        });

        const aliceInitialBalance = await lite.getTokenBalance(BMB_MINT, userAlice.address);

        const stakeResult = await lite.buildTransaction()
            .addInstruction(await aliceStake.getInstruction())
            .sendTransaction({ payer: userAlice });

        expect(stakeResult.logs).toBeDefined();

        // Verify Alice's BMB was transferred
        const aliceBalanceAfterStake = await lite.getTokenBalance(BMB_MINT, userAlice.address);
        expect(aliceInitialBalance - aliceBalanceAfterStake).toBe(aliceStakeAmount);

        // Verify UserStakePosition was created
        const alicePosition = await getUserPosition(lite, userAlice.address);
        expect(alicePosition).toBeDefined();
        expect(alicePosition.stakedAmount).toBe(aliceStakeAmount);
        expect(alicePosition.stakeEntries.length).toBe(1);

        // Verify offer totals updated
        const offer1AfterStake = await getOffer(lite, 1);
        expect(offer1AfterStake.totalStaked).toBe(aliceStakeAmount);

        // ========== 3. Bob stakes 500 BMB ==========
        const bobStakeAmount = 500n;
        const bobStake = new Stake({
            user: userBob.address,
            payer: userBob.address,
            amount: bobStakeAmount,
            user_bmb_token_account: bobBmbAta,
        });

        await lite.buildTransaction()
            .addInstruction(await bobStake.getInstruction())
            .sendTransaction({ payer: userBob });

        // Verify offer totals updated
        const offer1AfterBobStake = await getOffer(lite, 1);
        expect(offer1AfterBobStake.totalStaked).toBe(aliceStakeAmount + bobStakeAmount);

        // ========== 4. Deposit 10,000 USDC revenue ==========
        // Note: We pass TOTAL revenue (10,000 USDC)
        // Program will collect 100% (10,000 basis points) = 10,000 USDC
        const totalRevenue = 10_000n;
        const expectedCollected = 10_000n; // 100% of 10,000

        // Mock admin having USDC
        const adminUsdcAta = (await findAssociatedTokenPda({
            mint: USDC_MINT,
            owner: admin.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        }))[0];
        await lite.mintToken(USDC_MINT, admin.address, totalRevenue, admin);

        const depositRevenue = new DepositRevenue({
            depositor: admin.address,
            amount: totalRevenue, // Pass total revenue, not pre-calculated share
            depositor_usdc_token_account: adminUsdcAta,
        });

        await lite.buildTransaction()
            .addInstruction(await depositRevenue.getInstruction())
            .sendTransaction({ payer: admin });

        // Verify offer collected USDC updated (should be 100% of total revenue)
        const offer1AfterDeposit = await getOffer(lite, 1);
        expect(offer1AfterDeposit.collectedUsdc).toBe(expectedCollected);

        // ========== 5. Fast forward time past offer end ==========
        lite.setTime(BigInt(endTime) + 100n);

        // ========== 6. Alice claims rewards ==========
        const aliceClaim = new ClaimRewards({
            user: userAlice.address,
            offer_id: 1,
            user_usdc_token_account: aliceUsdcAta,
        });

        const aliceUsdcBefore = await lite.getTokenBalance(USDC_MINT, userAlice.address);

        await lite.buildTransaction()
            .addInstruction(await aliceClaim.getInstruction())
            .sendTransaction({ payer: userAlice });

        // Alice should get ~66.67% (1000 / 1500)
        const aliceUsdcAfter = await lite.getTokenBalance(USDC_MINT, userAlice.address);
        const aliceReward = aliceUsdcAfter - aliceUsdcBefore;
        expect(aliceReward).toBeGreaterThan(6_600n); // At least 66%
        expect(aliceReward).toBeLessThan(6_700n); // At most 67%

        // Verify last_claimed_offer updated
        const alicePositionAfterClaim = await getUserPosition(lite, userAlice.address);
        expect(alicePositionAfterClaim.lastClaimedOffer).toBe(1);

        // ========== 7. Bob claims rewards ==========
        const bobClaim = new ClaimRewards({
            user: userBob.address,
            offer_id: 1,
            user_usdc_token_account: bobUsdcAta,
        });

        const bobUsdcBefore = await lite.getTokenBalance(USDC_MINT, userBob.address);

        await lite.buildTransaction()
            .addInstruction(await bobClaim.getInstruction())
            .sendTransaction({ payer: userBob });

        // Bob should get ~33.33% (500 / 1500)
        const bobUsdcAfter = await lite.getTokenBalance(USDC_MINT, userBob.address);
        const bobReward = bobUsdcAfter - bobUsdcBefore;
        expect(bobReward).toBeGreaterThan(3_300n); // At least 33%
        expect(bobReward).toBeLessThan(3_400n); // At most 34%

        // Total rewards should be very close to collected amount (allowing for rounding dust)
        const totalRewards = aliceReward + bobReward;
        expect(totalRewards).toBeGreaterThanOrEqual(expectedCollected - 5n); // Allow up to 5 tokens dust
        expect(totalRewards).toBeLessThanOrEqual(expectedCollected);
    });

    it('should allow adding more stake', async () => {
        // Initialize offer
        const now = BigInt(Math.floor(Date.now() / 1000));
        const startTime = now + 10n; // Must be in the future
        const initOffer = new InitializeOffer({
            admin: admin.address,
            payer: admin.address,
            offer_id: 1,
            start_time: startTime,
            end_time: now + 86400n * 30n,
            revenue_percentage: 500,
        });
        await lite.buildTransaction()
            .addInstruction(await initOffer.getInstruction())
            .sendTransaction({ payer: admin });

        // Advance time to be within the offer period
        lite.setTime(startTime + 1n);

        // Alice stakes initial amount
        await lite.buildTransaction()
            .addInstruction(await (new Stake({
                user: userAlice.address,
                payer: userAlice.address,
                amount: 1_000n,
                user_bmb_token_account: aliceBmbAta,
            })).getInstruction())
            .sendTransaction({ payer: userAlice });

        const alicePositionAfterStake = await getUserPosition(lite, userAlice.address);
        expect(alicePositionAfterStake.stakedAmount).toBe(1_000n);
        expect(alicePositionAfterStake.stakeEntries.length).toBe(1);

        // Alice adds more stake
        const addStake = new AddStake({
            user: userAlice.address,
            payer: userAlice.address,
            amount: 500n,
            user_bmb_token_account: aliceBmbAta,
        });

        await lite.buildTransaction()
            .addInstruction(await addStake.getInstruction())
            .sendTransaction({ payer: userAlice });

        const alicePositionAfterAdd = await getUserPosition(lite, userAlice.address);
        expect(alicePositionAfterAdd.stakedAmount).toBe(1_500n);
        expect(alicePositionAfterAdd.stakeEntries.length).toBe(2);
    });

    it('should handle opt-out flow', async () => {
        // Initialize and stake
        const now = BigInt(Math.floor(Date.now() / 1000));
        const startTime = now + 10n; // Must be in the future
        const initOffer = new InitializeOffer({
            admin: admin.address,
            payer: admin.address,
            offer_id: 1,
            start_time: startTime,
            end_time: now + 86400n * 30n,
            revenue_percentage: 500,
        });
        await lite.buildTransaction()
            .addInstruction(await initOffer.getInstruction())
            .sendTransaction({ payer: admin });

        // Advance time to be within the offer period
        lite.setTime(startTime + 1n);

        await lite.buildTransaction()
            .addInstruction(await (new Stake({
                user: userAlice.address,
                payer: userAlice.address,
                amount: 1_000n,
                user_bmb_token_account: aliceBmbAta,
            })).getInstruction())
            .sendTransaction({ payer: userAlice });

        // Alice opts out
        const optOut = new OptOutRollover({
            user: userAlice.address,
        });

        await lite.buildTransaction()
            .addInstruction(await optOut.getInstruction())
            .sendTransaction({ payer: userAlice });

        const alicePosition = await getUserPosition(lite, userAlice.address);
        expect(alicePosition.optedOutAtOffer).toBe(1);

        // Verify offer tracked opt-out
        const offer = await getOffer(lite, 1);
        expect(offer.totalStakedOptedOut).toBe(1_000n);

        // Fast forward past offer end
        lite.setTime(BigInt(now + 86400n * 31n));

        // Alice unstakes
        const unstake = new Unstake({
            user: userAlice.address,
            user_bmb_token_account: aliceBmbAta,
            opted_out_offer_id: 1,
        });

        const aliceBmbBefore = await lite.getTokenBalance(BMB_MINT, userAlice.address);

        await lite.buildTransaction()
            .addInstruction(await unstake.getInstruction())
            .sendTransaction({ payer: userAlice });

        // Verify Alice got her BMB back
        const aliceBmbAfter = await lite.getTokenBalance(BMB_MINT, userAlice.address);
        expect(aliceBmbAfter - aliceBmbBefore).toBe(1_000n);
    });
});

// Helper functions
async function getOfferBook(lite: LiteDepin): Promise<OfferBookAccount> {
    const pda = await OfferBookAccount.findOfferBookPDA();
    const data = lite.getAccountData(pda[0]);
    return OfferBookAccount.deserializeFrom(data!);
}

async function getOffer(lite: LiteDepin, offerId: number) {
    const offerBook = await getOfferBook(lite);
    return offerBook.findOffer(offerId);
}

async function getUserPosition(lite: LiteDepin, user: Address): Promise<UserStakePositionAccount> {
    const pda = await UserStakePositionAccount.findUserStakePositionPDA(user);
    const data = lite.getAccountData(pda[0]);
    return UserStakePositionAccount.deserializeFrom(data!);
}
