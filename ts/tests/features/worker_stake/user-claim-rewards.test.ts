import {
    BMB_MINT,
    bmbToBaseUnits,
    ClaimRewards,
    DepositEmissions,
    DepositRevenue,
    InitializeWorkerStakeConfig,
    MonthlyPoolConfig,
    SetMonthlyPool,
    Stake,
    TreasuryAuthority,
    USDC_MINT,
    UserStakePositionAccount,
    WORKER_STAKE_PROGRAM,
    WorkerStakeConfigAccount
} from '@beamable-network/depin';
import { AssetWithProof } from '@metaplex-foundation/mpl-bubblegum';
import { Address, address } from 'gill';
import { beforeEach, describe, expect, it } from 'vitest';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';
import { setupTokens, TokenAuthorities, usdcToBaseUnits } from '../../helpers/spl-tokens.js';

describe('User Claim Rewards Instructions', async () => {
    let lite: LiteDepin;
    let stakeAdmin: LiteKeyPair;
    let workerCollection: Address;
    let tokenAuthorities: TokenAuthorities;
    let collectionCreator: LiteKeyPair;
    let workerWallet: LiteKeyPair;
    let worker: LiteKeyPair;
    let workerLicense: AssetWithProof;
    let revenueSource: LiteKeyPair;

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
        });

        await lite.buildTransaction()
            .addInstruction(await depositRev.getInstruction())
            .sendTransaction({ payer: revenueSource });
    }

    // Helper to deposit emissions
    async function depositEmissions(amount: bigint, monthPeriod: number) {
        // Query config to get last_active_pool_month
        const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
        const configData = lite.getAccountData(configPda);
        const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

        const depositEmiss = new DepositEmissions({
            depositor: revenueSource.address,
            worker_collection: workerCollection,
            worker_wallet: workerWallet.address,
            month_period: monthPeriod,
            amount: amount,
            has_monthly_pool: true,
        });

        // Only set previous pool if last_active_pool_month exists
        if (config.last_active_pool_month > 0) {
            depositEmiss.previous_pool_month_period = config.last_active_pool_month;
        }

        await lite.buildTransaction()
            .addInstruction(await depositEmiss.getInstruction())
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

    describe('Basic Claiming', () => {
        it('should successfully claim base USDC rewards', async () => {
            const { user } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            // Deposit revenue (1000 USDC)
            const revenueAmount = usdcToBaseUnits(1000);
            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            // Advance to month 6 (after month 5 ends) to allow claiming
            lite.goToMonthPeriod(6);

            // Claim rewards
            const claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // Verify user received base USDC rewards (20% of 1000 = 200 USDC)
            const usdcBalance = await lite.getTokenBalance(USDC_MINT, user.address);
            expect(usdcBalance).toBeGreaterThan(0n);
            expect(usdcBalance).toBe(usdcToBaseUnits(200));

            // Verify last_claimed_month_period was updated
            const [userPositionPda] = await UserStakePositionAccount.findUserStakePositionPDA(user.address, workerCollection);
            const positionData = lite.getAccountData(userPositionPda);
            const position = UserStakePositionAccount.deserializeFrom(positionData!);
            expect(position.last_claimed_month_period).toBe(5);
        });

        it('should successfully claim base BMB emissions', async () => {
            const { user } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);
            
            const [workerStakeTreasuryPda] = await TreasuryAuthority.findWorkerStakeTreasuryPDA(workerCollection);            
            let stakeTreasuryBalance = await lite.getTokenBalance(BMB_MINT, workerStakeTreasuryPda);
            expect(stakeTreasuryBalance).toBe(0n);

            // Deposit emissions (1000 BMB)
            const emissionAmount = bmbToBaseUnits(1000);
            await lite.mintToken(BMB_MINT, revenueSource.address, emissionAmount, tokenAuthorities.bmbMintAuthority);
            await depositEmissions(emissionAmount, 5);
            
            stakeTreasuryBalance = await lite.getTokenBalance(BMB_MINT, workerStakeTreasuryPda);
            
            expect(stakeTreasuryBalance).toBe(emissionAmount * 15n / 100n); // 15% of 1000 BMB

            // Advance to month 6 (after month 5 ends) to allow claiming
            lite.goToMonthPeriod(6);

            // Claim rewards
            const claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // Verify user received base BMB emissions (15% of 1000 = 150 BMB)
            // User already has 0 BMB since they staked all
            const bmbBalance = await lite.getTokenBalance(BMB_MINT, user.address);
            expect(bmbBalance).toBe(bmbToBaseUnits(150)); // 150 BMB
        });

        it('should successfully claim addon USDC rewards with checker licenses', async () => {
            const { user } = await createStakedUser(bmbToBaseUnits(7500), 3, 5);

            // Deposit revenue (1000 USDC)
            const revenueAmount = usdcToBaseUnits(1000);
            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            // Advance to month 6 (after month 5 ends) to allow claiming
            lite.goToMonthPeriod(6);

            const claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // Verify user received both base and addon USDC rewards
            // Base: 20% of 1000 = 200 USDC
            // Addon: 10% of 1000 = 100 USDC
            // Total: 300 USDC
            const usdcBalance = await lite.getTokenBalance(USDC_MINT, user.address);
            expect(usdcBalance).toBe(usdcToBaseUnits(300));
        });

        it('should claim triple rewards (base USDC + addon USDC + base BMB)', async () => {
            const { user } = await createStakedUser(bmbToBaseUnits(10000), 4, 5);

            // Deposit both revenue and emissions
            const revenueAmount = usdcToBaseUnits(2000);
            const emissionAmount = bmbToBaseUnits(500); // 500 BMB

            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            await lite.mintToken(BMB_MINT, revenueSource.address, emissionAmount, tokenAuthorities.bmbMintAuthority);
            await depositEmissions(emissionAmount, 5);

            // Advance to month 6 (after month 5 ends) to allow claiming
            lite.goToMonthPeriod(6);

            const claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // Verify USDC rewards: Base (20% of 2000) + Addon (10% of 2000) = 400 + 200 = 600 USDC
            const usdcBalance = await lite.getTokenBalance(USDC_MINT, user.address);
            expect(usdcBalance).toBe(usdcToBaseUnits(600));

            // Verify BMB rewards: Base (15% of 500) = 75 BMB
            const bmbBalance = await lite.getTokenBalance(BMB_MINT, user.address);
            expect(bmbBalance).toBe(bmbToBaseUnits(75));
        });

        it('should allow claiming when emissions not deposited yet', async () => {
            const { user } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            // Only deposit revenue, no emissions
            const revenueAmount = usdcToBaseUnits(1000);
            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            // Advance to month 6 (after month 5 ends) to allow claiming
            lite.goToMonthPeriod(6);

            // Should succeed even without emissions
            const claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // Verify user received USDC but no BMB
            const usdcBalance = await lite.getTokenBalance(USDC_MINT, user.address);
            expect(usdcBalance).toBe(usdcToBaseUnits(200));

            const bmbBalance = await lite.getTokenBalance(BMB_MINT, user.address);
            expect(bmbBalance).toBe(0n);
        });

        it('should allow claiming when only emissions deposited (no revenue, pool initialized by emissions)', async () => {
            // User stakes in month 5
            const { user } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            // Advance to month 6 (after month 5 ends)
            lite.goToMonthPeriod(6);

            // Create pool for month 6
            const pools: MonthlyPoolConfig[] = [{
                month_period: 6,
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

            // Only deposit emissions for month 6 - no revenue, no staking
            // This should initialize the pool and inherit stake from month 5
            const emissionAmount = bmbToBaseUnits(1000);
            await lite.mintToken(BMB_MINT, revenueSource.address, emissionAmount, tokenAuthorities.bmbMintAuthority);
            await depositEmissions(emissionAmount, 6);

            // Advance to month 7 to allow claiming month 6
            lite.goToMonthPeriod(7);

            // First claim month 5 (required for sequential claiming)
            const claimMonth5 = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            await lite.buildTransaction()
                .addInstruction(await claimMonth5.getInstruction())
                .sendTransaction({ payer: user });

            // Now claim month 6 - should succeed even though pool was only initialized by emissions
            const claimMonth6 = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 6,
            });

            await lite.buildTransaction()
                .addInstruction(await claimMonth6.getInstruction())
                .sendTransaction({ payer: user });

            // Verify user received BMB emissions (15% of 1000 = 150 BMB) but no USDC
            const bmbBalance = await lite.getTokenBalance(BMB_MINT, user.address);
            expect(bmbBalance).toBe(bmbToBaseUnits(150)); // 15% of 1000 BMB

            // No USDC since no revenue was deposited
            const usdcBalance = await lite.getTokenBalance(USDC_MINT, user.address);
            expect(usdcBalance).toBe(0n);
        });
    });

    describe('Sequential Claiming', () => {
        it('should enforce sequential claiming order', async () => {
            // Create additional pools for months 6, 7 (month 5 already exists from beforeEach)
            const pools: MonthlyPoolConfig[] = [
                {
                    month_period: 6,
                    base_revenue_percentage: 2000,
                    addon_revenue_percentage: 1000,
                    base_emission_percentage: 1500,
                },
                {
                    month_period: 7,
                    base_revenue_percentage: 2000,
                    addon_revenue_percentage: 1000,
                    base_emission_percentage: 1500,
                }
            ];

            const setPool = new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools,
            });

            await lite.buildTransaction()
                .addInstruction(await setPool.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            const { user } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            // Deposit revenue for all months
            const revenueAmount = usdcToBaseUnits(1000);
            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount * 3n, tokenAuthorities.usdcMintAuthority);

            // Deposit for month 5 (while in month 5)
            await depositRevenue(revenueAmount, 5);

            // Advance to month 6 and deposit
            lite.goToMonthPeriod(6);
            await depositRevenue(revenueAmount, 6, 5); // Inherit from month 5

            // Advance to month 7 and deposit
            lite.goToMonthPeriod(7);
            await depositRevenue(revenueAmount, 7, 6); // Inherit from month 6

            // Advance to month 8 (after all months end) to allow claiming
            lite.goToMonthPeriod(8);

            // Claim month 5 - should succeed
            let claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // Try to claim month 7 (skipping 6) - should fail
            claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 7,
            });

            await expect(async () => {
                await lite.buildTransaction()
                    .addInstruction(await claimRewards.getInstruction())
                    .sendTransaction({ payer: user });
            }).rejects.toThrow("Must claim months in order");

            // Claim month 6 - should now succeed
            claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 6,
            });

            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // Claim month 7 - should succeed
            claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 7,
            });

            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // Verify last_claimed_month_period
            const [userPositionPda] = await UserStakePositionAccount.findUserStakePositionPDA(user.address, workerCollection);
            const positionData = lite.getAccountData(userPositionPda);
            const position = UserStakePositionAccount.deserializeFrom(positionData!);
            expect(position.last_claimed_month_period).toBe(7);

            // Verify total USDC received (200 * 3 = 600)
            const usdcBalance = await lite.getTokenBalance(USDC_MINT, user.address);
            expect(usdcBalance).toBe(usdcToBaseUnits(600));
        });

        it('should fail when trying to claim same month twice', async () => {
            const { user } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            const revenueAmount = usdcToBaseUnits(1000);
            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount * 2n, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            // Advance to month 6 (after month 5 ends) to allow claiming
            lite.goToMonthPeriod(6);

            const claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            // First claim - should succeed
            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // Second claim - should fail
            await expect(async () => {
                await lite.buildTransaction()
                    .addInstruction(await claimRewards.getInstruction())
                    .sendTransaction({ payer: user });
            }).rejects.toThrow("Must claim months in order");
        });
    });

    describe('Multiple Users Claiming', () => {
        it('should distribute rewards proportionally among multiple stakers', async () => {
            // User 1: 5000 BMB (no checker licenses)
            const { user: user1 } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            // User 2: 5000 BMB (no checker licenses)
            const { user: user2 } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            // Total staked: 10000 BMB, each user has 50%

            // Deposit revenue (1000 USDC)
            const revenueAmount = usdcToBaseUnits(1000);
            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            // Advance to month 6 (after month 5 ends) to allow claiming
            lite.goToMonthPeriod(6);

            // User 1 claims
            let claimRewards = new ClaimRewards({
                user: user1.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user1 });

            // User 2 claims
            claimRewards = new ClaimRewards({
                user: user2.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user2 });

            // Each user should receive 50% of base pool (20% of 1000 = 200 USDC total)
            // Each gets 100 USDC
            const user1UsdcBalance = await lite.getTokenBalance(USDC_MINT, user1.address);
            const user2UsdcBalance = await lite.getTokenBalance(USDC_MINT, user2.address);

            expect(user1UsdcBalance).toBe(usdcToBaseUnits(100));
            expect(user2UsdcBalance).toBe(usdcToBaseUnits(100));
        });

        it('should distribute addon rewards only to checker license holders', async () => {
            // User 1: 7500 BMB with 3 checker licenses
            const { user: user1 } = await createStakedUser(bmbToBaseUnits(7500), 3, 5);

            // User 2: 5000 BMB with 0 checker licenses
            const { user: user2 } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            // Deposit revenue (1000 USDC)
            const revenueAmount = usdcToBaseUnits(1000);
            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            // Advance to month 6 (after month 5 ends) to allow claiming
            lite.goToMonthPeriod(6);

            // User 1 claims
            let claimRewards = new ClaimRewards({
                user: user1.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user1 });

            // User 2 claims
            claimRewards = new ClaimRewards({
                user: user2.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user2 });

            // User 1: base (60% of 200) + addon (100% of 100) = 120 + 100 = 220 USDC
            // User 2: base (40% of 200) + addon (0) = 80 USDC
            const user1UsdcBalance = await lite.getTokenBalance(USDC_MINT, user1.address);
            const user2UsdcBalance = await lite.getTokenBalance(USDC_MINT, user2.address);

            // User 1 gets more due to addon rewards
            expect(user1UsdcBalance).toBeGreaterThan(user2UsdcBalance);
            expect(user1UsdcBalance).toBeGreaterThan(usdcToBaseUnits(200)); // More than base share alone
        });
    });

    describe('Edge Cases', () => {
        it('should fail when claiming for a month user was not staked', async () => {
            const { user } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            // Create pool for month 10
            const pools: MonthlyPoolConfig[] = [{
                month_period: 10,
                base_revenue_percentage: 2000,
                addon_revenue_percentage: 1000,
                base_emission_percentage: 1500,
            }];

            const setPool = new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools,
            });

            await lite.buildTransaction()
                .addInstruction(await setPool.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Try to claim month 10 (user only staked in month 5)
            const claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 10,
            });

            await expect(async () => {
                await lite.buildTransaction()
                    .addInstruction(await claimRewards.getInstruction())
                    .sendTransaction({ payer: user });
            }).rejects.toThrow();
        });

        it('should fail when claiming current month', async () => {
            const { user } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            // Deposit revenue for month 5
            const revenueAmount = usdcToBaseUnits(1000);
            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            // Don't advance time - still in month 5

            const claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            // Should fail because we're still in month 5
            await expect(async () => {
                await lite.buildTransaction()
                    .addInstruction(await claimRewards.getInstruction())
                    .sendTransaction({ payer: user });
            }).rejects.toThrow("Cannot claim current or future months");
        });

        it('should handle zero rewards gracefully', async () => {
            const { user } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            // Don't deposit any revenue or emissions

            // Advance to month 6 to allow claiming
            lite.goToMonthPeriod(6);

            const claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            // Should succeed with 0 rewards
            await lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // Verify position was updated even with 0 rewards
            const [userPositionPda] = await UserStakePositionAccount.findUserStakePositionPDA(user.address, workerCollection);
            const positionData = lite.getAccountData(userPositionPda);
            const position = UserStakePositionAccount.deserializeFrom(positionData!);
            expect(position.last_claimed_month_period).toBe(5);

            // Verify balances are 0
            const usdcBalance = await lite.getTokenBalance(USDC_MINT, user.address);
            const bmbBalance = await lite.getTokenBalance(BMB_MINT, user.address);
            expect(usdcBalance).toBe(0n);
            expect(bmbBalance).toBe(0n);
        });

        it('should enforce first-time claimers start from earliest month', async () => {
            // Month 5 already exists from beforeEach, create months 6 and 7
            const pools: MonthlyPoolConfig[] = [
                { month_period: 6, base_revenue_percentage: 2000, addon_revenue_percentage: 1000, base_emission_percentage: 1500 },
                { month_period: 7, base_revenue_percentage: 2000, addon_revenue_percentage: 1000, base_emission_percentage: 1500 }
            ];

            await lite.buildTransaction()
                .addInstruction(await (new SetMonthlyPool({
                    collection_authority: collectionCreator.address,
                    worker_collection: workerCollection,
                    pools,
                })).getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // User stakes in month 5
            const { user } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            // Deposit revenue for all months
            const revenueAmount = usdcToBaseUnits(1000);
            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount * 3n, tokenAuthorities.usdcMintAuthority);

            await depositRevenue(revenueAmount, 5);
            lite.goToMonthPeriod(6);
            await depositRevenue(revenueAmount, 6, 5);
            lite.goToMonthPeriod(7);
            await depositRevenue(revenueAmount, 7, 6);
            lite.goToMonthPeriod(8);

            // Try to claim month 7 first (skipping 5 and 6) - should fail
            await expect(async () => {
                await lite.buildTransaction()
                    .addInstruction(await (new ClaimRewards({
                        user: user.address,
                        worker_collection: workerCollection,
                        month_period: 7,
                    })).getInstruction())
                    .sendTransaction({ payer: user });
            }).rejects.toThrow("First claim must be for earliest month");
        });
    });
});
