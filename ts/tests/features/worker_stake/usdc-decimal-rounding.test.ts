import {
    BMB_MINT,
    bmbToBaseUnits,
    ClaimRewards,
    DepositRevenue,
    getUsdcMint,
    InitializeWorkerStakeConfig,
    MonthlyPoolConfig,
    SetMonthlyPool,
    Stake,
    WORKER_STAKE_PROGRAM,
} from '@beamable-network/depin';
import { AssetWithProof } from '@metaplex-foundation/mpl-bubblegum';
import { Address, address } from 'gill';
import { beforeEach, describe, expect, it } from 'vitest';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';
import { setupTokens, TokenAuthorities, usdcToBaseUnits } from '../../helpers/spl-tokens.js';

/**
 * USDC Decimal and Rounding Tests
 *
 * This test suite specifically focuses on ensuring that USDC rewards (6 decimals) are properly
 * calculated when distributed based on BMB stake (9 decimals). The key concern is that integer
 * division might cause precision loss or incorrect rounding.
 *
 * Key facts:
 * - USDC has 6 decimals (1 USDC = 1,000,000 base units)
 * - BMB has 9 decimals (1 BMB = 1,000,000,000 base units)
 * - Reward calculation: (usdc_collected × user_stake_days) ÷ total_weighted_stake_days
 * - This should cancel out BMB decimals: (USDC_6 × BMB_9) ÷ BMB_9 = USDC_6
 */
describe('USDC Decimal and Rounding Tests', async () => {
    let lite: LiteDepin;
    let stakeAdmin: LiteKeyPair;
    let workerCollection: Address;
    let tokenAuthorities: TokenAuthorities;
    let collectionCreator: LiteKeyPair;
    let workerWallet: LiteKeyPair;
    let worker: LiteKeyPair;
    let workerLicense: AssetWithProof;
    let revenueSource: LiteKeyPair;
    let network: "devnet" | "mainnet" = "devnet";
    let usdcMint: Address = getUsdcMint(network);

    // Helper to create a staked user
    async function createStakedUser(
        stakeAmount: bigint,
        checkerCount: number,
        monthPeriod: number
    ): Promise<{ user: LiteKeyPair }> {
        const user = await lite.generateKeyPair();
        await lite.airdrop(user, 2);

        await lite.mintToken(BMB_MINT, user.address, stakeAmount, tokenAuthorities.bmbMintAuthority);

        const stake = new Stake({
            user: user.address,
            worker: worker.address,
            worker_license: workerLicense,
            worker_collection: workerCollection,
            amount: stakeAmount,
            checker_count: checkerCount,
            current_month_period: monthPeriod,
        });

        await lite.buildTransaction()
            .addInstruction(await stake.getInstruction())
            .sign(user)
            .sendTransaction({ payer: worker });

        return { user };
    }

    // Helper to deposit revenue
    async function depositRevenue(amount: bigint, monthPeriod: number, previousPoolMonth?: number) {
        const depositRev = new DepositRevenue({
            revenue_source: revenueSource.address,
            worker_collection: workerCollection,
            worker_wallet: workerWallet.address,
            total_revenue: amount,
            current_month_period: monthPeriod,
            has_monthly_pool: true,
            previous_pool_month_period: previousPoolMonth,
            network
        });

        await lite.buildTransaction()
            .addInstruction(await depositRev.getInstruction())
            .sendTransaction({ payer: revenueSource });
    }

    beforeEach(async () => {
        lite = new LiteDepin();

        // Set clock to period 5
        lite.goToMonthPeriod(5);

        // Setup admin
        stakeAdmin = await lite.generateKeyPair();
        await lite.airdrop(stakeAdmin, 10);
        lite.setProgramUpgradeAuthority(WORKER_STAKE_PROGRAM, stakeAdmin.web3PublicKey);

        // Setup tokens
        tokenAuthorities = await setupTokens(lite);

        // Setup collection
        collectionCreator = await lite.generateKeyPair();
        await lite.airdrop(collectionCreator, 10);
        await lite.createLicenseTree({ creator: collectionCreator });
        workerCollection = address(lite.getCollectionMint()!.publicKey);

        // Setup worker wallet
        workerWallet = await lite.generateKeyPair();
        await lite.airdrop(workerWallet, 2);

        // Mint worker license
        worker = await lite.generateKeyPair();
        await lite.airdrop(worker, 2);
        workerLicense = await lite.mintLicense({
            creator: collectionCreator,
            to: worker,
        });

        // Setup revenue source
        revenueSource = await lite.generateKeyPair();
        await lite.airdrop(revenueSource, 10);

        // Initialize worker stake config
        const initConfig = new InitializeWorkerStakeConfig({
            payer: stakeAdmin.address,
            upgrade_authority: stakeAdmin.address,
            worker_collection: workerCollection,
            worker_wallet: workerWallet.address,
            min_stake_requirement: bmbToBaseUnits(100),
        });

        await lite.buildTransaction()
            .addInstruction(await initConfig.getInstruction())
            .sendTransaction({ payer: stakeAdmin });

        // Create a monthly pool for month 5
        const pools: MonthlyPoolConfig[] = [{
            month_period: 5,
            base_revenue_percentage: 2000, // 20%
            addon_revenue_percentage: 1000, // 10%
            base_emission_percentage: 1500, // 15%
        }];

        const setPool = new SetMonthlyPool({
            collection_authority: collectionCreator.address,
            worker_collection: workerCollection,
            pools,
        });

        await lite.buildTransaction()
            .addInstruction(await setPool.getInstruction())
            .sendTransaction({ payer: collectionCreator });
    });

    describe('Basic USDC Decimal Handling', () => {
        it('should correctly handle USDC with 6 decimals (whole numbers)', async () => {
            // Single user stakes 1000 BMB (9 decimals)
            const { user } = await createStakedUser(bmbToBaseUnits(1000), 0, 5);

            // Deposit exactly 100 USDC (6 decimals)
            const revenueAmount = usdcToBaseUnits(100); // 100_000_000 base units
            await lite.mintToken(usdcMint, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            // Advance to month 6 to allow claiming
            lite.goToMonthPeriod(6);

            // Claim rewards
            const claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
                network
            });

            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // User should receive exactly 20 USDC (20% of 100 USDC)
            const usdcBalance = await lite.getTokenBalance(usdcMint, user.address);
            expect(usdcBalance).toBe(usdcToBaseUnits(20)); // 20_000_000 base units
        });

        it('should correctly handle fractional USDC amounts', async () => {
            // Single user stakes 5000 BMB
            const { user } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            // Deposit 0.123456 USDC (using all 6 decimal places)
            const revenueAmount = 123456n; // 0.123456 USDC in base units
            await lite.mintToken(usdcMint, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            // Advance to month 6
            lite.goToMonthPeriod(6);

            // Claim rewards
            const claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
                network
            });

            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // User should receive 20% of 0.123456 = 0.0246912 USDC = 24691 base units (rounded down)
            const expectedReward = (123456n * 20n) / 100n; // 24691 base units
            const usdcBalance = await lite.getTokenBalance(usdcMint, user.address);
            expect(usdcBalance).toBe(expectedReward);
        });

        it('should handle minimum USDC unit (1 base unit = 0.000001 USDC)', async () => {
            // Single user stakes 1000 BMB
            const { user } = await createStakedUser(bmbToBaseUnits(1000), 0, 5);

            // Deposit 1 base unit (0.000001 USDC)
            const revenueAmount = 1n;
            await lite.mintToken(usdcMint, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            // Advance to month 6
            lite.goToMonthPeriod(6);

            // Claim rewards
            const claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
                network
            });

            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // 20% of 1 base unit = 0 (rounds down)
            const usdcBalance = await lite.getTokenBalance(usdcMint, user.address);
            expect(usdcBalance).toBe(0n);
        });
    });

    describe('Rounding Behavior with Multiple Users', () => {
        it('should properly distribute USDC when division is exact', async () => {
            // Two users with equal stakes
            const { user: user1 } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);
            const { user: user2 } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            // Deposit 1000 USDC (20% = 200 USDC to pool)
            const revenueAmount = usdcToBaseUnits(1000);
            await lite.mintToken(usdcMint, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            lite.goToMonthPeriod(6);

            // User 1 claims
            let claimRewards = new ClaimRewards({
                user: user1.address,
                worker_collection: workerCollection,
                month_period: 5,
                network
            });
            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user1 });

            // User 2 claims
            claimRewards = new ClaimRewards({
                user: user2.address,
                worker_collection: workerCollection,
                month_period: 5,
                network
            });
            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user2 });

            // Each user should receive exactly 100 USDC (50% of 200 USDC pool)
            const user1Balance = await lite.getTokenBalance(usdcMint, user1.address);
            const user2Balance = await lite.getTokenBalance(usdcMint, user2.address);

            expect(user1Balance).toBe(usdcToBaseUnits(100));
            expect(user2Balance).toBe(usdcToBaseUnits(100));

            // Total should equal the pool
            expect(user1Balance + user2Balance).toBe(usdcToBaseUnits(200));
        });

        it('should handle rounding down when USDC does not divide evenly', async () => {
            // Three users with equal stakes (each gets 33.333...% of pool)
            const { user: user1 } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);
            const { user: user2 } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);
            const { user: user3 } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            // Deposit revenue that results in 100 USDC to pool
            // 100 USDC / 3 = 33.333333... USDC per user
            // In base units: 100_000_000 / 3 = 33_333_333.333... = 33_333_333 (rounds down)
            const revenueAmount = usdcToBaseUnits(500); // 20% = 100 USDC
            await lite.mintToken(usdcMint, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            lite.goToMonthPeriod(6);

            // All users claim
            for (const user of [user1, user2, user3]) {
                const claimRewards = new ClaimRewards({
                    user: user.address,
                    worker_collection: workerCollection,
                    month_period: 5,
                    network
                });
                await lite.buildTransaction()
                    .addInstruction(await claimRewards.getInstruction())
                    .sendTransaction({ payer: user });
            }

            const user1Balance = await lite.getTokenBalance(usdcMint, user1.address);
            const user2Balance = await lite.getTokenBalance(usdcMint, user2.address);
            const user3Balance = await lite.getTokenBalance(usdcMint, user3.address);

            // Each user gets 33_333_333 base units (33.333333 USDC, rounded down)
            const expectedPerUser = 33_333_333n;
            expect(user1Balance).toBe(expectedPerUser);
            expect(user2Balance).toBe(expectedPerUser);
            expect(user3Balance).toBe(expectedPerUser);

            // Total claimed will be slightly less than pool due to rounding
            // 33_333_333 * 3 = 99_999_999 (1 base unit = 0.000001 USDC lost to rounding)
            const totalClaimed = user1Balance + user2Balance + user3Balance;
            const poolAmount = usdcToBaseUnits(100);
            expect(totalClaimed).toBe(99_999_999n);
            expect(poolAmount - totalClaimed).toBe(1n); // 1 base unit dust remains
        });

        it('should handle very small USDC amounts with unequal stakes', async () => {
            // User 1: 90% of stake
            // User 2: 10% of stake
            const { user: user1 } = await createStakedUser(bmbToBaseUnits(9000), 0, 5);
            const { user: user2 } = await createStakedUser(bmbToBaseUnits(1000), 0, 5);

            // Deposit very small amount: 0.00001 USDC = 10 base units
            // 20% goes to pool = 2 base units
            const revenueAmount = 10n;
            await lite.mintToken(usdcMint, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            lite.goToMonthPeriod(6);

            // User 1 claims (should get 90% of 2 = 1.8 = 1 base unit rounded down)
            let claimRewards = new ClaimRewards({
                user: user1.address,
                worker_collection: workerCollection,
                month_period: 5,
                network
            });
            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user1 });

            // User 2 claims (should get 10% of 2 = 0.2 = 0 base units rounded down)
            claimRewards = new ClaimRewards({
                user: user2.address,
                worker_collection: workerCollection,
                month_period: 5,
                network
            });
            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user2 });

            const user1Balance = await lite.getTokenBalance(usdcMint, user1.address);
            const user2Balance = await lite.getTokenBalance(usdcMint, user2.address);

            // User 1 gets 1 base unit (90% of 2, rounded down)
            // User 2 gets 0 base units (10% of 2, rounded down)
            expect(user1Balance).toBe(1n);
            expect(user2Balance).toBe(0n);
        });
    });

    describe('Addon Pool USDC Handling', () => {
        it('should correctly handle USDC in addon pool with checker licenses', async () => {
            // User with 3 checker licenses and 7500 BMB (3 points)
            const { user } = await createStakedUser(bmbToBaseUnits(7500), 3, 5);

            // Deposit 1000 USDC (addon pool gets 10% = 100 USDC)
            const revenueAmount = usdcToBaseUnits(1000);
            await lite.mintToken(usdcMint, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            lite.goToMonthPeriod(6);

            const claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
                network
            });

            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // User should receive:
            // Base: 20% of 1000 = 200 USDC
            // Addon: 10% of 1000 = 100 USDC
            // Total: 300 USDC
            const usdcBalance = await lite.getTokenBalance(usdcMint, user.address);
            expect(usdcBalance).toBe(usdcToBaseUnits(300));
        });

        it('should handle addon pool rounding with multiple users and unequal points', async () => {
            // User 1: 2 points (2 licenses, 5000 BMB)
            // User 2: 1 point (1 license, 2500 BMB)
            // Total: 3 points
            const { user: user1 } = await createStakedUser(bmbToBaseUnits(5000), 2, 5);
            const { user: user2 } = await createStakedUser(bmbToBaseUnits(2500), 1, 5);

            // Deposit 1000 USDC
            // Addon pool: 10% = 100 USDC
            // User 1 should get: (2/3) * 100 = 66.666666... USDC = 66_666_666 base units (rounded down)
            // User 2 should get: (1/3) * 100 = 33.333333... USDC = 33_333_333 base units (rounded down)
            const revenueAmount = usdcToBaseUnits(1000);
            await lite.mintToken(usdcMint, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            lite.goToMonthPeriod(6);

            // User 1 claims
            let claimRewards = new ClaimRewards({
                user: user1.address,
                worker_collection: workerCollection,
                month_period: 5,
                network
            });
            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user1 });

            // User 2 claims
            claimRewards = new ClaimRewards({
                user: user2.address,
                worker_collection: workerCollection,
                month_period: 5,
                network
            });
            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user2 });

            const user1Balance = await lite.getTokenBalance(usdcMint, user1.address);
            const user2Balance = await lite.getTokenBalance(usdcMint, user2.address);

            // User 1: Base (5000/7500 * 200) + Addon (2/3 * 100)
            // Base: 133_333_333 base units
            // Addon: 66_666_666 base units
            // Total: 199_999_999 base units
            const user1Expected = 133_333_333n + 66_666_666n;
            expect(user1Balance).toBe(user1Expected);

            // User 2: Base (2500/7500 * 200) + Addon (1/3 * 100)
            // Base: 66_666_666 base units
            // Addon: 33_333_333 base units
            // Total: 99_999_999 base units
            const user2Expected = 66_666_666n + 33_333_333n;
            expect(user2Balance).toBe(user2Expected);

            // Total claimed: should be very close to 300 USDC (with small rounding dust)
            const totalClaimed = user1Balance + user2Balance;
            const totalPool = usdcToBaseUnits(300);

            // Due to rounding, we lose 2 base units (0.000002 USDC)
            expect(totalClaimed).toBe(299_999_998n);
            expect(totalPool - totalClaimed).toBe(2n);
        });
    });

    describe('Edge Cases and Precision', () => {
        it('should handle very large USDC amounts without overflow', async () => {
            // Single user stakes 1000 BMB
            const { user } = await createStakedUser(bmbToBaseUnits(1000), 0, 5);

            // Deposit 1 billion USDC (very large amount)
            // Base pool gets 20% = 200 million USDC
            const revenueAmount = usdcToBaseUnits(1_000_000_000);
            await lite.mintToken(usdcMint, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            lite.goToMonthPeriod(6);

            const claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
                network
            });

            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // Should receive exactly 200 million USDC
            const usdcBalance = await lite.getTokenBalance(usdcMint, user.address);
            expect(usdcBalance).toBe(usdcToBaseUnits(200_000_000));
        });

        it('should handle user with very small stake relative to total', async () => {
            // User 1: 99.999% of stake (999,990 BMB)
            // User 2: 0.001% of stake (10 BMB)
            const { user: user1 } = await createStakedUser(bmbToBaseUnits(999990), 0, 5);
            const { user: user2 } = await createStakedUser(bmbToBaseUnits(10), 0, 5);

            // Deposit 1000 USDC (base pool gets 200 USDC)
            const revenueAmount = usdcToBaseUnits(1000);
            await lite.mintToken(usdcMint, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            lite.goToMonthPeriod(6);

            // User 2 claims (tiny stake)
            let claimRewards = new ClaimRewards({
                user: user2.address,
                worker_collection: workerCollection,
                month_period: 5,
                network
            });
            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user2 });

            const user2Balance = await lite.getTokenBalance(usdcMint, user2.address);

            // User 2 has 10/1,000,000 = 0.00001 of total stake
            // Should get 0.00001 * 200 USDC = 0.002 USDC = 2000 base units
            const expectedUser2 = 2000n;
            expect(user2Balance).toBe(expectedUser2);

            // User 1 claims (large stake)
            claimRewards = new ClaimRewards({
                user: user1.address,
                worker_collection: workerCollection,
                month_period: 5,
                network
            });
            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user1 });

            const user1Balance = await lite.getTokenBalance(usdcMint, user1.address);

            // User 1 should get almost all of the 200 USDC
            // The sum should be close to 200 USDC (minus rounding dust)
            const totalClaimed = user1Balance + user2Balance;
            const poolAmount = usdcToBaseUnits(200);

            // Should be very close to pool amount
            expect(totalClaimed).toBeGreaterThan(poolAmount - 10n); // Within 10 base units
            expect(totalClaimed).toBeLessThanOrEqual(poolAmount);
        });

        it('should maintain precision when stake has maximum BMB decimals', async () => {
            // Stake a very precise amount using all 9 decimals
            // 1234.567890123 BMB = 1_234_567_890_123 base units
            const preciseStake = 1_234_567_890_123n;
            const { user } = await createStakedUser(preciseStake, 0, 5);

            // Deposit 999.999999 USDC (using all 6 decimals)
            const revenueAmount = 999_999_999n; // 999.999999 USDC
            await lite.mintToken(usdcMint, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            lite.goToMonthPeriod(6);

            const claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
                network
            });

            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // Should receive 20% of 999.999999 = 199.9999998 USDC = 199_999_999 base units (rounded down)
            const expectedReward = (999_999_999n * 20n) / 100n;
            const usdcBalance = await lite.getTokenBalance(usdcMint, user.address);
            expect(usdcBalance).toBe(expectedReward);
        });
    });
});
