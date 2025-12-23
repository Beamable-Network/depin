import {
    bmbToBaseUnits,
    InitializeWorkerStakeConfig,
    SetMonthlyPool,
    Stake,
    Unstake,
    MonthlyPoolConfig,
    WorkerStakeConfigAccount,
    MonthlyPoolAccount,
    UserStakePositionAccount,
    WORKER_STAKE_PROGRAM,
    BMB_MINT,
    daysInMonth,
    timestampToPeriod,
    ClaimRewards,
    DepositRevenue,
    DepositEmissions,
    getUsdcMint,
} from '@beamable-network/depin';
import { Address, address } from 'gill';
import { beforeEach, describe, expect, it } from 'vitest';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';
import { setupTokens, TokenAuthorities, usdcToBaseUnits } from '../../helpers/spl-tokens.js';
import { AssetWithProof } from '@metaplex-foundation/mpl-bubblegum';

describe('Pool Inheritance Tests', async () => {
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

        // Query config to get last_active_pool_month
        const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
        const configData = lite.getAccountData(configPda);
        const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

        const stake = new Stake({
            user: user.address,
            worker: worker.address,
            worker_license: workerLicense,
            worker_collection: workerCollection,
            amount: stakeAmount,
            checker_count: checkerCount,
            current_month_period: monthPeriod,
        });

        // Only set previous pool if last_active_pool_month exists and is different from current
        if (config.last_active_pool_month > 0 && config.last_active_pool_month !== monthPeriod) {
            stake.previous_pool_month_period = config.last_active_pool_month;
        }

        lite.buildTransaction()
            .addInstruction(await stake.getInstruction())
            .sign(user)
            .sendTransaction({ payer: worker });

        return { user };
    }

    // Helper to deposit revenue
    async function depositRevenue(amount: bigint, monthPeriod: number) {
        // Query config to get last_active_pool_month
        const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
        const configData = lite.getAccountData(configPda);
        const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

        const depositRev = new DepositRevenue({
            revenue_source: revenueSource.address,
            worker_collection: workerCollection,
            worker_wallet: workerWallet.address,
            total_revenue: amount,
            current_month_period: monthPeriod,
            has_monthly_pool: true,
            network
        });

        // Only set previous pool if last_active_pool_month exists
        if (config.last_active_pool_month > 0) {
            depositRev.previous_pool_month_period = config.last_active_pool_month;
        }

        lite.buildTransaction()
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

        lite.buildTransaction()
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

        lite.buildTransaction()
            .addInstruction(await initConfig.getInstruction())
            .sendTransaction({ payer: stakeAdmin });
    });

    it('should recalculate weighted total with full month weight during inheritance when points decrease', async () => {
        // This test verifies that when a new month starts, the inheritance logic correctly
        // recalculates total_weighted using the full month's days (not carrying over partial weights).
        //
        // Scenario:
        // - Month 5 (November, 30 days): User stakes 6 days before end with 4 points
        //   → total_weighted = 4 × 6 = 24
        // - Month 6 (December, 31 days): Inheritance runs, then user updates to 2 points (15 days before end)
        //   → Inheritance sets: total_weighted = 4 × 31 = 124 (full month weight)
        //   → User update: weighted_delta = 2 × 15 = 30
        //   → Final: total_weighted = 124 - 30 = 94
        //
        // Without inheritance recalculation, this would incorrectly be: 24 - 30 = -6 (underflow)

        const pools: MonthlyPoolConfig[] = [
            {
                month_period: 5,
                base_revenue_percentage: 2000,
                addon_revenue_percentage: 1000,
                base_emission_percentage: 1500,
            },
            {
                month_period: 6,
                base_revenue_percentage: 2000,
                addon_revenue_percentage: 1000,
                base_emission_percentage: 1500,
            }
        ];

        lite.buildTransaction()
            .addInstruction(await (new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools,
            })).getInstruction())
            .sendTransaction({ payer: collectionCreator });

        const user = await lite.generateKeyPair();
        await lite.airdrop(user, 2);
        await lite.mintToken(BMB_MINT, user.address, bmbToBaseUnits(20000), tokenAuthorities.bmbMintAuthority);

        // Month 5: Stake 6 days before end with 4 points
        lite.goToMonthPeriod(5);
        const month5StartPeriod = timestampToPeriod(lite.getTime());
        lite.goToPeriod(month5StartPeriod + daysInMonth(5) - 6);

        lite.buildTransaction()
            .addInstruction(await (new Stake({
                user: user.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: bmbToBaseUnits(10000),
                checker_count: 4,
                current_month_period: 5,
            })).getInstruction())
            .sign(user)
            .sendTransaction({ payer: worker });

        const [poolPda5] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
        const pool5 = MonthlyPoolAccount.deserializeFrom(lite.getAccountData(poolPda5)!);

        expect(pool5.addon_pool.total).toBe(4n);
        expect(pool5.addon_pool.total_weighted).toBe(24n); // 4 × 6 = 24

        // Month 6: Update 15 days before end, reducing points from 4 to 2
        lite.goToMonthPeriod(6);
        const month6StartPeriod = timestampToPeriod(lite.getTime());
        lite.goToPeriod(month6StartPeriod + daysInMonth(6) - 15);

        const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
        const config = WorkerStakeConfigAccount.deserializeFrom(lite.getAccountData(configPda)!);

        const stake2 = new Stake({
            user: user.address,
            worker: worker.address,
            worker_license: workerLicense,
            worker_collection: workerCollection,
            amount: bmbToBaseUnits(1),
            checker_count: 2, // Reduced from 4 to 2
            current_month_period: 6,
        });
        if (config.last_active_pool_month > 0) {
            stake2.previous_pool_month_period = config.last_active_pool_month;
        }

        lite.buildTransaction()
            .addInstruction(await stake2.getInstruction())
            .sign(user)
            .sendTransaction({ payer: worker });

        const [poolPda6] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 6);
        const pool6 = MonthlyPoolAccount.deserializeFrom(lite.getAccountData(poolPda6)!);

        // Verify inheritance recalculated correctly
        // Expected: 4 points × 31 days (full month) - (2 points × 15 days) = 124 - 30 = 94
        expect(pool6.addon_pool.total).toBe(2n);
        expect(pool6.addon_pool.total_weighted).toBe(94n);
    });

    it('should handle stake inheritance across months', async () => {
        // Create pool for month 5
        const month5Pools: MonthlyPoolConfig[] = [{
            month_period: 5,
            base_revenue_percentage: 2000,
            addon_revenue_percentage: 1000,
            base_emission_percentage: 1500,
        }];

        const setPool = new SetMonthlyPool({
            collection_authority: collectionCreator.address,
            worker_collection: workerCollection,
            pools: month5Pools,
        });

        lite.buildTransaction()
            .addInstruction(await setPool.getInstruction())
            .sendTransaction({ payer: collectionCreator });

        // User stakes in month 5
        const { user } = await createStakedUser(bmbToBaseUnits(5000), 2, 5);

        // Verify month 5 pool
        let [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
        let poolData = lite.getAccountData(poolPda);
        let pool = MonthlyPoolAccount.deserializeFrom(poolData!);
        expect(pool.base_pool.total).toBe(bmbToBaseUnits(5000));
        expect(pool.addon_pool.total).toBe(2n);

        // Create pool for month 6 (should inherit from month 5)
        const month6Pools: MonthlyPoolConfig[] = [{
            month_period: 6,
            base_revenue_percentage: 2000,
            addon_revenue_percentage: 1000,
            base_emission_percentage: 1500,
        }];

        const setMonth6Pool = new SetMonthlyPool({
            collection_authority: collectionCreator.address,
            worker_collection: workerCollection,
            pools: month6Pools,
        });

        lite.buildTransaction()
            .addInstruction(await setMonth6Pool.getInstruction())
            .sendTransaction({ payer: collectionCreator });

        // Trigger inheritance by staking in month 6
        lite.goToMonthPeriod(6);
        const { user: user2 } = await createStakedUser(bmbToBaseUnits(3000), 1, 6);

        // Verify month 6 pool inherited from month 5
        [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 6);
        poolData = lite.getAccountData(poolPda);
        pool = MonthlyPoolAccount.deserializeFrom(poolData!);

        // Should have inherited 5000 + new 3000 = 8000
        expect(pool.base_pool.total).toBe(bmbToBaseUnits(8000));
        // Should have inherited 2 points + new 1 point = 3 points
        expect(pool.addon_pool.total).toBe(3n);
    });

    it('should handle partial opt-out with inheritance', async () => {
        // Create pools for months 5 and 6
        const pools: MonthlyPoolConfig[] = [
            {
                month_period: 5,
                base_revenue_percentage: 2000,
                addon_revenue_percentage: 1000,
                base_emission_percentage: 1500,
            },
            {
                month_period: 6,
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

        lite.buildTransaction()
            .addInstruction(await setPool.getInstruction())
            .sendTransaction({ payer: collectionCreator });

        // Three users stake in month 5
        const { user: user1 } = await createStakedUser(bmbToBaseUnits(5000), 2, 5);
        const { user: user2 } = await createStakedUser(bmbToBaseUnits(5000), 2, 5);
        const { user: user3 } = await createStakedUser(bmbToBaseUnits(5000), 2, 5);

        // Verify month 5 pool totals
        let [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
        let poolData = lite.getAccountData(poolPda);
        let pool = MonthlyPoolAccount.deserializeFrom(poolData!);
        expect(pool.base_pool.total).toBe(bmbToBaseUnits(15000));
        expect(pool.addon_pool.total).toBe(6n); // 2 + 2 + 2

        // User 1 and User 2 opt out
        const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
        const configData = lite.getAccountData(configPda);
        const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

        let unstake = new Unstake({
            user: user1.address,
            worker_collection: workerCollection,
            last_active_pool_month_period: config.last_active_pool_month,
        });

        lite.buildTransaction()
            .addInstruction(await unstake.getInstruction())
            .sendTransaction({ payer: user1 });

        unstake = new Unstake({
            user: user2.address,
            worker_collection: workerCollection,
            last_active_pool_month_period: config.last_active_pool_month,
        });

        lite.buildTransaction()
            .addInstruction(await unstake.getInstruction())
            .sendTransaction({ payer: user2 });

        // Verify opted-out was tracked
        poolData = lite.getAccountData(poolPda);
        pool = MonthlyPoolAccount.deserializeFrom(poolData!);
        expect(pool.base_pool.total_opted_out).toBe(bmbToBaseUnits(10000)); // user1 + user2
        expect(pool.addon_pool.total_opted_out).toBe(4n); // 2 + 2 points

        // Trigger month 6 pool initialization (should inherit only user3's stake)
        lite.goToMonthPeriod(6);
        const { user: user4 } = await createStakedUser(bmbToBaseUnits(2500), 1, 6);

        // Verify month 6 inherited only non-opted-out stake
        [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 6);
        poolData = lite.getAccountData(poolPda);
        pool = MonthlyPoolAccount.deserializeFrom(poolData!);

        // Should have: user3's 5000 (inherited) + user4's 2500 (new) = 7500
        expect(pool.base_pool.total).toBe(bmbToBaseUnits(7500));
        // Should have: user3's 2 points (inherited) + user4's 1 point (new) = 3
        expect(pool.addon_pool.total).toBe(3n);
    });

    it('should handle pool inheritance with gaps (months 5 and 9 only)', async () => {
        // Create pools for months 5 and 9 only (no pools for 6, 7, 8)
        const pools: MonthlyPoolConfig[] = [
            {
                month_period: 5,
                base_revenue_percentage: 2000, // 20%
                addon_revenue_percentage: 1000, // 10%
                base_emission_percentage: 1500, // 15%
            },
            {
                month_period: 9,
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

        lite.buildTransaction()
            .addInstruction(await setPool.getInstruction())
            .sendTransaction({ payer: collectionCreator });

        // User stakes in month 5
        const { user } = await createStakedUser(bmbToBaseUnits(10000), 4, 5);

        // Verify month 5 pool state
        let [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
        let poolData = lite.getAccountData(poolPda);
        let pool = MonthlyPoolAccount.deserializeFrom(poolData!);
        expect(pool.base_pool.total).toBe(bmbToBaseUnits(10000));
        expect(pool.addon_pool.total).toBe(4n); // 4 points

        // Deposit revenue and emissions for month 5
        const revenueAmount = usdcToBaseUnits(1000); // 1000 USDC
        const emissionAmount = bmbToBaseUnits(500); // 500 BMB

        await lite.mintToken(usdcMint, revenueSource.address, revenueAmount * 2n, tokenAuthorities.usdcMintAuthority);
        await lite.mintToken(BMB_MINT, revenueSource.address, emissionAmount * 2n, tokenAuthorities.bmbMintAuthority);

        await depositRevenue(revenueAmount, 5);
        await depositEmissions(emissionAmount, 5);

        // Advance to month 6 and claim month 5 rewards
        lite.goToMonthPeriod(6);

        let claimRewards = new ClaimRewards({
            user: user.address,
            worker_collection: workerCollection,
            month_period: 5,
            network
        });

        lite.buildTransaction()
            .addInstruction(await claimRewards.getInstruction())
            .sendTransaction({ payer: user });

        // Verify month 5 rewards received
        // Base USDC: 20% of 1000 = 200 USDC
        // Addon USDC: 10% of 1000 = 100 USDC
        // Total USDC: 300 USDC
        // Base BMB: 15% of 500 = 75 BMB
        let usdcBalance = await lite.getTokenBalance(usdcMint, user.address);
        let bmbBalance = await lite.getTokenBalance(BMB_MINT, user.address);
        expect(usdcBalance).toBe(usdcToBaseUnits(300));
        expect(bmbBalance).toBe(bmbToBaseUnits(75));

        // Advance to month 9 (skipping months 6, 7, 8)
        lite.goToMonthPeriod(9);

        // Deposit revenue and emissions for month 9
        // This should trigger inheritance from month 5 (last_active_pool_month)
        await depositRevenue(revenueAmount, 9);
        await depositEmissions(emissionAmount, 9);

        // Verify month 9 pool inherited from month 5
        [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 9);
        poolData = lite.getAccountData(poolPda);
        pool = MonthlyPoolAccount.deserializeFrom(poolData!);

        // Should have inherited user's stake (10000 BMB)
        expect(pool.base_pool.total).toBe(bmbToBaseUnits(10000));
        // Weighted value is now stake × days_in_month (month 9 = March = 31 days)
        // 10000 BMB × 31 days = 310000
        expect(pool.base_pool.total_weighted).toBe(bmbToBaseUnits(310000));
        // Should have inherited user's points (4 points)
        expect(pool.addon_pool.total).toBe(4n);
        // Weighted points is now points × days_in_month (4 points × 31 days = 124)
        expect(pool.addon_pool.total_weighted).toBe(124n);

        // Verify revenue and emissions were collected
        expect(pool.base_pool.collected).toBe(usdcToBaseUnits(200)); // 20% of 1000
        expect(pool.addon_pool.collected).toBe(usdcToBaseUnits(100)); // 10% of 1000
        expect(pool.collected_bmb_base).toBe(bmbToBaseUnits(75)); // 15% of 500

        // Claim months 6, 7, 8 (no pools exist, will skip with 0 rewards)
        for (const skipMonth of [6, 7, 8]) {
            claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: skipMonth,
                network
            });

            lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });
        }

        // Advance to month 10 and claim month 9 rewards
        lite.goToMonthPeriod(10);

        claimRewards = new ClaimRewards({
            user: user.address,
            worker_collection: workerCollection,
            month_period: 9,
            network
        });

        lite.buildTransaction()
            .addInstruction(await claimRewards.getInstruction())
            .sendTransaction({ payer: user });

        // Verify month 9 rewards received (same amounts as month 5)
        // User had full weight in month 9 (inherited stake)
        usdcBalance = await lite.getTokenBalance(usdcMint, user.address);
        bmbBalance = await lite.getTokenBalance(BMB_MINT, user.address);

        // Total USDC should be: month 5 (300) + month 9 (300) = 600
        expect(usdcBalance).toBe(usdcToBaseUnits(600));
        // Total BMB should be: month 5 (75) + month 9 (75) = 150
        expect(bmbBalance).toBe(bmbToBaseUnits(150));

        // Verify user's last claimed month was updated
        const [userPositionPda] = await UserStakePositionAccount.findUserStakePositionPDA(user.address, workerCollection);
        const positionData = lite.getAccountData(userPositionPda);
        const position = UserStakePositionAccount.deserializeFrom(positionData!);
        expect(position.last_claimed_month_period).toBe(9);
    });
});
