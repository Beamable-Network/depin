import {
    bmbToBaseUnits,
    InitializeWorkerStakeConfig,
    SetMonthlyPool,
    Stake,
    Unstake,
    Withdraw,
    ClaimRewards,
    DepositRevenue,
    DepositEmissions,
    MonthlyPoolConfig,
    WorkerStakeConfigAccount,
    MonthlyPoolAccount,
    UserStakePositionAccount,
    WORKER_STAKE_PROGRAM,
    BMB_MINT,
    USDC_MINT
} from '@beamable-network/depin';
import { Address, address } from 'gill';
import { beforeEach, describe, expect, it } from 'vitest';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';
import { setupTokens, TokenAuthorities } from '../../helpers/spl-tokens.js';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { AssetWithProof } from '@metaplex-foundation/mpl-bubblegum';

describe('User Integration Tests - Complex Scenarios', async () => {
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
    ): Promise<{ user: LiteKeyPair; userTokenAccount: Address }> {
        const user = await lite.generateKeyPair();
        await lite.airdrop(user, 2);

        await lite.mintToken(BMB_MINT, user.address, stakeAmount, tokenAuthorities.bmbMintAuthority);

        const [userTokenAccount] = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: user.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        const stake = new Stake({
            user: user.address,
            worker: worker.address,
            worker_license: workerLicense,
            worker_collection: workerCollection,
            amount: stakeAmount,
            checker_count: checkerCount,
            current_month_period: monthPeriod,
            user_token_account: userTokenAccount,
        });
        if (monthPeriod > 0) {
            stake.previous_pool_month_period = monthPeriod - 1;
        }

        lite.buildTransaction()
            .addInstruction(await stake.getInstruction())
            .sign(worker)
            .sendTransaction({ payer: user });

        return { user, userTokenAccount };
    }

    // Helper to deposit revenue
    async function depositRevenue(amount: bigint, monthPeriod: number) {
        const [revenueSourceUsdcAccount] = await findAssociatedTokenPda({
            mint: USDC_MINT,
            owner: revenueSource.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        const [workerWalletUsdcAccount] = await findAssociatedTokenPda({
            mint: USDC_MINT,
            owner: workerWallet.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        const depositRev = new DepositRevenue({
            revenue_source: revenueSource.address,
            worker_collection: workerCollection,
            worker_wallet: workerWallet.address,
            total_revenue: amount,
            current_month_period: monthPeriod,
            revenue_source_usdc_account: revenueSourceUsdcAccount,
            worker_wallet_usdc_account: workerWalletUsdcAccount,
            has_monthly_pool: true,
        });

        lite.buildTransaction()
            .addInstruction(await depositRev.getInstruction())
            .sendTransaction({ payer: revenueSource });
    }

    // Helper to deposit emissions
    async function depositEmissions(amount: bigint, monthPeriod: number) {
        const [depositorBmbAccount] = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: revenueSource.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        const [workerWalletBmbAccount] = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: workerWallet.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        const depositEmiss = new DepositEmissions({
            depositor: revenueSource.address,
            worker_collection: workerCollection,
            worker_wallet: workerWallet.address,
            month_period: monthPeriod,
            amount: amount,
            depositor_bmb_account: depositorBmbAccount,
            worker_wallet_bmb_account: workerWalletBmbAccount,
            has_monthly_pool: true,
        });

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

    describe('Multi-Month Staking and Rewards', () => {
        it('should handle complete lifecycle across multiple months', async () => {
            // Create pools for months 5, 6, 7
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

            lite.buildTransaction()
                .addInstruction(await setPool.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // User stakes in month 5
            const { user, userTokenAccount } = await createStakedUser(bmbToBaseUnits(10000), 4, 5);

            // Deposit revenue and emissions for all months
            const revenueAmount = 1000n * 1000000n; // 1000 USDC per month
            const emissionAmount = bmbToBaseUnits(500); // 500 BMB per month

            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount * 3n, tokenAuthorities.usdcMintAuthority);
            await lite.mintToken(BMB_MINT, revenueSource.address, emissionAmount * 3n, tokenAuthorities.bmbMintAuthority);

            await depositRevenue(revenueAmount, 5);
            await depositEmissions(emissionAmount, 5);

            await depositRevenue(revenueAmount, 6);
            await depositEmissions(emissionAmount, 6);

            await depositRevenue(revenueAmount, 7);
            await depositEmissions(emissionAmount, 7);

            // Advance to month 8 (after all months end) to allow claiming
            lite.goToMonthPeriod(8);

            // Claim rewards for all months sequentially
            const [userUsdcAccount] = await findAssociatedTokenPda({
                mint: USDC_MINT,
                owner: user.address,
                tokenProgram: TOKEN_PROGRAM_ADDRESS
            });

            const [userBmbAccount] = await findAssociatedTokenPda({
                mint: BMB_MINT,
                owner: user.address,
                tokenProgram: TOKEN_PROGRAM_ADDRESS
            });

            for (const monthPeriod of [5, 6, 7]) {
                const claimRewards = new ClaimRewards({
                    user: user.address,
                    worker_collection: workerCollection,
                    month_period: monthPeriod,
                    user_usdc_account: userUsdcAccount,
                    user_bmb_account: userBmbAccount,
                });

                lite.buildTransaction()
                    .addInstruction(await claimRewards.getInstruction())
                    .sendTransaction({ payer: user });
            }

            // Verify total rewards (3 months × (200 base + 100 addon) = 900 USDC)
            const usdcBalance = await lite.getTokenBalance(USDC_MINT, user.address);
            expect(usdcBalance).toBe(900n * 1000000n);

            // Verify BMB emissions (3 months × 75 BMB = 225 BMB)
            const bmbBalance = await lite.getTokenBalance(BMB_MINT, user.address);
            expect(bmbBalance).toBe(bmbToBaseUnits(225));

            // Now unstake
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            const unstake = new Unstake({
                user: user.address,
                worker_collection: workerCollection,
                last_active_pool_month_period: config.last_active_pool_month,
            });

            lite.buildTransaction()
                .addInstruction(await unstake.getInstruction())
                .sendTransaction({ payer: user });

            // Create month 8 pool to allow withdrawal
            const month8Pools: MonthlyPoolConfig[] = [{
                month_period: 8,
                base_revenue_percentage: 2000,
                addon_revenue_percentage: 1000,
                base_emission_percentage: 1500,
            }];

            const setMonth8Pool = new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools: month8Pools,
            });

            lite.buildTransaction()
                .addInstruction(await setMonth8Pool.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Withdraw
            const withdraw = new Withdraw({
                user: user.address,
                worker_collection: workerCollection,
                user_token_account: userTokenAccount,
            });

            lite.buildTransaction()
                .addInstruction(await withdraw.getInstruction())
                .sendTransaction({ payer: user });

            // Verify final BMB balance (initial stake + emissions)
            const finalBmbBalance = await lite.getTokenBalance(BMB_MINT, user.address);
            expect(finalBmbBalance).toBe(bmbToBaseUnits(10000 + 225)); // Stake + emissions
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
    });

    describe('Complex Opt-Out Scenarios', () => {
        it('should handle partial opt-out with multiple users', async () => {
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

            // Should have: user3's 5000 (inherited) + user4's 2000 (new) = 7000
            expect(pool.base_pool.total).toBe(bmbToBaseUnits(7500));
            // Should have: user3's 2 points (inherited) + user4's 1 point (new) = 3
            expect(pool.addon_pool.total).toBe(3n);
        });
    });

    describe('Checker License Management', () => {
        it('should track checker count changes across multiple stakes', async () => {
            const pools: MonthlyPoolConfig[] = [{
                month_period: 5,
                base_revenue_percentage: 2000,
                addon_revenue_percentage: 1000,
                base_emission_percentage: 1500,
            }];

            const setPool = new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools,
            });

            lite.buildTransaction()
                .addInstruction(await setPool.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            const user = await lite.generateKeyPair();
            await lite.airdrop(user, 2);

            const totalStake = bmbToBaseUnits(15000);
            await lite.mintToken(BMB_MINT, user.address, totalStake, tokenAuthorities.bmbMintAuthority);

            const [userTokenAccount] = await findAssociatedTokenPda({
                mint: BMB_MINT,
                owner: user.address,
                tokenProgram: TOKEN_PROGRAM_ADDRESS
            });

            // First stake: 5000 BMB, 2 checker licenses (2 points)
            let stake = new Stake({
                user: user.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: bmbToBaseUnits(5000),
                checker_count: 2,
                current_month_period: 5,
                user_token_account: userTokenAccount,
            });

            lite.buildTransaction()
                .addInstruction(await stake.getInstruction())
                .sign(worker)
                .sendTransaction({ payer: user });

            // Verify points: min(2, 5000/2500) = 2
            let [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            let poolData = lite.getAccountData(poolPda);
            let pool = MonthlyPoolAccount.deserializeFrom(poolData!);
            expect(pool.addon_pool.total).toBe(2n);

            // Second stake: +5000 BMB, bought 2 more licenses (total: 4 licenses, 10000 BMB)
            stake = new Stake({
                user: user.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: bmbToBaseUnits(5000),
                checker_count: 4,
                current_month_period: 5,
                user_token_account: userTokenAccount,
            });

            lite.buildTransaction()
                .addInstruction(await stake.getInstruction())
                .sign(worker)
                .sendTransaction({ payer: user });

            // Verify points: min(4, 10000/2500) = 4
            poolData = lite.getAccountData(poolPda);
            pool = MonthlyPoolAccount.deserializeFrom(poolData!);
            expect(pool.addon_pool.total).toBe(4n);

            // Third stake: +5000 BMB, bought 1 more license (total: 5 licenses, 15000 BMB)
            stake = new Stake({
                user: user.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: bmbToBaseUnits(5000),
                checker_count: 5,
                current_month_period: 5,
                user_token_account: userTokenAccount,
            });

            lite.buildTransaction()
                .addInstruction(await stake.getInstruction())
                .sign(worker)
                .sendTransaction({ payer: user });

            // Verify points: min(5, 15000/2500) = 5
            poolData = lite.getAccountData(poolPda);
            pool = MonthlyPoolAccount.deserializeFrom(poolData!);
            expect(pool.addon_pool.total).toBe(5n);

            // Verify user position has 3 entries with different checker counts
            const [userPositionPda] = await UserStakePositionAccount.findUserStakePositionPDA(user.address, workerCollection);
            const positionData = lite.getAccountData(userPositionPda);
            const position = UserStakePositionAccount.deserializeFrom(positionData!);

            expect(position.stake_entries).toHaveLength(3);
            expect(position.stake_entries[0].checker_count).toBe(2);
            expect(position.stake_entries[1].checker_count).toBe(4);
            expect(position.stake_entries[2].checker_count).toBe(5);
            expect(position.staked_amount).toBe(bmbToBaseUnits(15000));
        });

        it('should handle checker count decreasing (sold licenses)', async () => {
            const pools: MonthlyPoolConfig[] = [{
                month_period: 5,
                base_revenue_percentage: 2000,
                addon_revenue_percentage: 1000,
                base_emission_percentage: 1500,
            }];

            const setPool = new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools,
            });

            lite.buildTransaction()
                .addInstruction(await setPool.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            const user = await lite.generateKeyPair();
            await lite.airdrop(user, 2);

            const totalStake = bmbToBaseUnits(10000);
            await lite.mintToken(BMB_MINT, user.address, totalStake, tokenAuthorities.bmbMintAuthority);

            const [userTokenAccount] = await findAssociatedTokenPda({
                mint: BMB_MINT,
                owner: user.address,
                tokenProgram: TOKEN_PROGRAM_ADDRESS
            });

            // First stake: 7500 BMB, 3 checker licenses (3 points)
            let stake = new Stake({
                user: user.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: bmbToBaseUnits(7500),
                checker_count: 3,
                current_month_period: 5,
                user_token_account: userTokenAccount,
            });

            lite.buildTransaction()
                .addInstruction(await stake.getInstruction())
                .sign(worker)
                .sendTransaction({ payer: user });

            let [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            let poolData = lite.getAccountData(poolPda);
            let pool = MonthlyPoolAccount.deserializeFrom(poolData!);
            expect(pool.addon_pool.total).toBe(3n);

            // Second stake: +2500 BMB, sold 1 license (total: 2 licenses, 10000 BMB)
            stake = new Stake({
                user: user.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: bmbToBaseUnits(2500),
                checker_count: 2,
                current_month_period: 5,
                user_token_account: userTokenAccount,
            });

            lite.buildTransaction()
                .addInstruction(await stake.getInstruction())
                .sign(worker)
                .sendTransaction({ payer: user });

            // Verify points decreased: min(2, 10000/2500) = 2 (was 3, now 2)
            poolData = lite.getAccountData(poolPda);
            pool = MonthlyPoolAccount.deserializeFrom(poolData!);
            expect(pool.addon_pool.total).toBe(2n); // Decreased from 3 to 2
        });
    });

    describe('Revenue and Emission Distribution', () => {
        it('should correctly split revenue between community and worker', async () => {
            const pools: MonthlyPoolConfig[] = [{
                month_period: 5,
                base_revenue_percentage: 3000, // 30%
                addon_revenue_percentage: 2000, // 20%
                base_emission_percentage: 1500,
            }];

            const setPool = new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools,
            });

            lite.buildTransaction()
                .addInstruction(await setPool.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Stake
            await createStakedUser(bmbToBaseUnits(10000), 4, 5);

            // Deposit 1000 USDC revenue
            const revenueAmount = 1000n * 1000000n;
            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);

            const initialWorkerBalance = await lite.getTokenBalance(USDC_MINT, workerWallet.address);

            await depositRevenue(revenueAmount, 5);

            // Verify splits:
            // Base: 30% of 1000 = 300 USDC to community
            // Addon: 20% of 1000 = 200 USDC to community
            // Total community: 500 USDC
            // Worker remainder: 500 USDC

            const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            const poolData = lite.getAccountData(poolPda);
            const pool = MonthlyPoolAccount.deserializeFrom(poolData!);

            expect(pool.base_pool.collected).toBe(300n * 1000000n);
            expect(pool.addon_pool.collected).toBe(200n * 1000000n);

            // Verify worker received remainder
            const finalWorkerBalance = await lite.getTokenBalance(USDC_MINT, workerWallet.address);
            expect(finalWorkerBalance - initialWorkerBalance).toBe(500n * 1000000n);
        });

        it('should handle multiple revenue deposits in same month', async () => {
            const pools: MonthlyPoolConfig[] = [{
                month_period: 5,
                base_revenue_percentage: 2000,
                addon_revenue_percentage: 1000,
                base_emission_percentage: 1500,
            }];

            const setPool = new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools,
            });

            lite.buildTransaction()
                .addInstruction(await setPool.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            // Deposit revenue 3 times
            const revenueAmount = 500n * 1000000n; // 500 USDC each time
            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount * 3n, tokenAuthorities.usdcMintAuthority);

            await depositRevenue(revenueAmount, 5);
            await depositRevenue(revenueAmount, 5);
            await depositRevenue(revenueAmount, 5);

            // Verify accumulated revenue (3 × 20% × 500 = 300 USDC base)
            const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            const poolData = lite.getAccountData(poolPda);
            const pool = MonthlyPoolAccount.deserializeFrom(poolData!);

            expect(pool.base_pool.collected).toBe(300n * 1000000n);
            expect(pool.addon_pool.collected).toBe(150n * 1000000n); // 3 × 10% × 500
        });
    });

    describe('Edge Cases and Error Handling', () => {
        it('should prevent withdrawal with pending unclaimed rewards', async () => {
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

            const { user, userTokenAccount } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            // Deposit revenue for month 5
            const revenueAmount = 1000n * 1000000n;
            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            // Unstake
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            const unstake = new Unstake({
                user: user.address,
                worker_collection: workerCollection,
                last_active_pool_month_period: config.last_active_pool_month,
            });

            lite.buildTransaction()
                .addInstruction(await unstake.getInstruction())
                .sendTransaction({ payer: user });

            // Try to withdraw without claiming - should fail
            const withdraw = new Withdraw({
                user: user.address,
                worker_collection: workerCollection,
                user_token_account: userTokenAccount,
            });

            lite.goToMonthPeriod(6);

            await expect(async () => {
                lite.buildTransaction()
                    .addInstruction(await withdraw.getInstruction())
                    .sendTransaction({ payer: user });
            }).rejects.toThrow("Must claim all pending rewards first");
        });

        it('should handle maximum stake entries per user', async () => {
            const pools: MonthlyPoolConfig[] = [{
                month_period: 5,
                base_revenue_percentage: 2000,
                addon_revenue_percentage: 1000,
                base_emission_percentage: 1500,
            }];

            const setPool = new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools,
            });

            lite.buildTransaction()
                .addInstruction(await setPool.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            const user = await lite.generateKeyPair();
            await lite.airdrop(user, 5);

            // Stake 25 times (max limit per TDD)
            const stakePerEntry = bmbToBaseUnits(1000);
            const totalStake = stakePerEntry * 25n;
            await lite.mintToken(BMB_MINT, user.address, totalStake, tokenAuthorities.bmbMintAuthority);

            const [userTokenAccount] = await findAssociatedTokenPda({
                mint: BMB_MINT,
                owner: user.address,
                tokenProgram: TOKEN_PROGRAM_ADDRESS
            });

            for (let i = 0; i < 25; i++) {
                const stake = new Stake({
                    user: user.address,
                    worker: worker.address,
                    worker_license: workerLicense,
                    worker_collection: workerCollection,
                    amount: stakePerEntry,
                    checker_count: 0,
                    current_month_period: 5,
                    user_token_account: userTokenAccount,
                });

                lite.buildTransaction()
                    .addInstruction(await stake.getInstruction())
                    .sign(worker)
                    .sendTransaction({ payer: user });
            }

            // Verify 25 entries were created
            const [userPositionPda] = await UserStakePositionAccount.findUserStakePositionPDA(user.address, workerCollection);
            const positionData = lite.getAccountData(userPositionPda);
            const position = UserStakePositionAccount.deserializeFrom(positionData!);

            expect(position.stake_entries).toHaveLength(25);
            expect(position.staked_amount).toBe(totalStake);
        });
    });
});
