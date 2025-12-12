import {
    BMB_MINT,
    bmbToBaseUnits,
    calculateUserRewardShare,
    ClaimRewards,
    DepositEmissions,
    DepositRevenue,
    InitializeWorkerStakeConfig,
    MonthlyPoolAccount,
    MonthlyPoolConfig,
    SetMonthlyPool,
    Stake,
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
import { getFilePoolName } from 'vitest/node.js';

describe('Stake Weight Calculation', async () => {
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

    async function createUser(params: { bmbAmount: number }): Promise<LiteKeyPair> {
        const user = await lite.generateKeyPair();
        await lite.mintToken(BMB_MINT, user.address, bmbToBaseUnits(params.bmbAmount), tokenAuthorities.bmbMintAuthority);
        await lite.airdrop(user, 2);
        return user;
    }

    async function getPosition(user: LiteKeyPair) {
        const [userPositionPda] = await UserStakePositionAccount.findUserStakePositionPDA(user.address, workerCollection);
        const positionData = lite.getAccountData(userPositionPda);
        return UserStakePositionAccount.deserializeFrom(positionData!);
    }

    async function stake(params: { user: LiteKeyPair, amount: number, checkers: number }) {
        const config = await getConfig();

        const stake = new Stake({
            user: params.user.address,
            worker: worker.address,
            worker_license: workerLicense,
            worker_collection: workerCollection,
            amount: bmbToBaseUnits(params.amount),
            checker_count: params.checkers,
            current_month_period: lite.getMonthPeriod(),
        });

        if (config.last_active_pool_month > 0) {
            stake.previous_pool_month_period = config.last_active_pool_month;
        }

        await lite.buildTransaction()
            .addInstruction(await stake.getInstruction())
            .sign(params.user)
            .sendTransaction({ payer: worker });
    }

    // Helper to deposit revenue
    async function depositRevenue(amount: bigint) {
        const config = await getConfig();

        const depositRev = new DepositRevenue({
            revenue_source: revenueSource.address,
            worker_collection: workerCollection,
            worker_wallet: workerWallet.address,
            total_revenue: amount,
            current_month_period: lite.getMonthPeriod(),
            has_monthly_pool: true
        });

        // Only set previous pool if last_active_pool_month exists
        if (config.last_active_pool_month > 0) {
            depositRev.previous_pool_month_period = config.last_active_pool_month;
        }

        await lite.buildTransaction()
            .addInstruction(await depositRev.getInstruction())
            .sendTransaction({ payer: revenueSource });
    }

    async function getConfig() {
        // Query config to get last_active_pool_month
        const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
        const configData = lite.getAccountData(configPda);
        return WorkerStakeConfigAccount.deserializeFrom(configData!);
    }

    async function getCurrentPool() {
        const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, lite.getMonthPeriod());
        const poolData = lite.getAccountData(poolPda);
        return MonthlyPoolAccount.deserializeFrom(poolData!);
    }

    async function getPool(month: number) {
        const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, month);
        const poolData = lite.getAccountData(poolPda);
        return MonthlyPoolAccount.deserializeFrom(poolData!);
    }

    // Helper to deposit emissions
    async function depositEmissions(amount: bigint) {
        const config = await getConfig();

        const depositEmiss = new DepositEmissions({
            depositor: revenueSource.address,
            worker_collection: workerCollection,
            worker_wallet: workerWallet.address,
            month_period: lite.getMonthPeriod(),
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

        // Create a monthly pool for months 5, 6
        const pools: MonthlyPoolConfig[] = [{
            month_period: 5,
            base_revenue_percentage: 5000, // 50%
            addon_revenue_percentage: 5000, // 50%
            base_emission_percentage: 10000, // 100%
        }, {
            month_period: 6,
            base_revenue_percentage: 5000, // 50%
            addon_revenue_percentage: 5000, // 50%
            base_emission_percentage: 10000, // 100%
        }];

        const setPool = new SetMonthlyPool({
            collection_authority: collectionCreator.address,
            worker_collection: workerCollection,
            pools,
        });

        await lite.buildTransaction()
            .addInstruction(await setPool.getInstruction())
            .sendTransaction({ payer: collectionCreator });

        await lite.mintToken(BMB_MINT, revenueSource.address, bmbToBaseUnits(1_000_000_000), tokenAuthorities.bmbMintAuthority);
        await lite.mintToken(USDC_MINT, revenueSource.address, usdcToBaseUnits(1_000_000_000), tokenAuthorities.usdcMintAuthority);
    });

    describe('Basic', () => {
        it('should match weight in a simple scenario', async () => {
            lite.goToMonthPeriod(5, { day: 1, hour: 1 });

            const user = await createUser({ bmbAmount: 1_000_000 });
            await stake({ user, amount: 1_000_000, checkers: 10 });

            // Deposit revenue (1000 USDC, 500 to base and 500 to addon)
            await depositRevenue(usdcToBaseUnits(1000));
            // Deposit emissions (1000 BMB)
            await depositEmissions(bmbToBaseUnits(1000));

            let position = await getPosition(user);
            expect(position.staked_amount).toBe(bmbToBaseUnits(1_000_000));

            let pool5 = await getCurrentPool();            
            
            // Manual calculation
            expect(pool5.base_pool.total).toBe(bmbToBaseUnits(1_000_000));
            expect(pool5.addon_pool.total).toBe(10n);
            expect(pool5.base_pool.total_weighted).toBe(bmbToBaseUnits(1_000_000) * 29n);
            expect(pool5.addon_pool.total_weighted).toBe(10n * 29n);

            // Share calculation
            const share = await calculateUserRewardShare(position, pool5, pool5.month_period);
            expect(share.userStakeDays).toBe(bmbToBaseUnits(1_000_000) * 29n);
            expect(share.userPointDays).toBe(10n * 29n);
            expect(share.totalUsdc).toBe(usdcToBaseUnits(1000));
            expect(share.totalBmb).toBe(bmbToBaseUnits(1000));
        });

        it('should match weight in a inheritance scenario', async () => {
            // November stake
            lite.goToMonthPeriod(5, { day: 1, hour: 1 });

            const user = await createUser({ bmbAmount: 100_000_000 });
            await stake({ user, amount: 1_000_000, checkers: 10 });

            // December stake, now with 15 checkers
            lite.goToMonthPeriod(6, { day: 1, hour: 1 });
            await stake({ user, amount: 1_000_000, checkers: 15 });

            let position = await getPosition(user);
            expect(position.staked_amount).toBe(bmbToBaseUnits(2_000_000));

            let pool6 = await getCurrentPool();
            
            // Manual calculation
            expect(pool6.base_pool.total).toBe(bmbToBaseUnits(2_000_000));
            expect(pool6.addon_pool.total).toBe(15n);
            expect(pool6.base_pool.total_weighted).toBe(bmbToBaseUnits(1_000_000) * 31n + bmbToBaseUnits(1_000_000) * 30n);
            expect(pool6.addon_pool.total_weighted).toBe(10n * 31n + 5n * 30n);

            // Share calculation
            const share = await calculateUserRewardShare(position, pool6, pool6.month_period);
            expect(share.userStakeDays).toBe(pool6.base_pool.total_weighted);
            expect(share.userPointDays).toBe(pool6.addon_pool.total_weighted);
        });
    });
});
