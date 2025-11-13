import {
    bmbToBaseUnits,
    BMB_MINT,
    DepositEmissions,
    DepositRevenue,
    InitializeWorkerStakeConfig,
    MonthlyPoolAccount,
    MonthlyPoolConfig,
    SetMonthlyPool,
    Stake,
    USDC_MINT,
    WORKER_STAKE_PROGRAM,
    WorkerStakeConfigAccount
} from '@beamable-network/depin';
import { AssetWithProof } from '@metaplex-foundation/mpl-bubblegum';
import { Address, address } from 'gill';
import { beforeEach, describe, expect, it } from 'vitest';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';
import { setupTokens, TokenAuthorities, usdcToBaseUnits } from '../../helpers/spl-tokens.js';

describe('Deposit tests', async () => {
    let lite: LiteDepin;
    let stakeAdmin: LiteKeyPair;
    let workerCollection: Address;
    let tokenAuthorities: TokenAuthorities;
    let collectionCreator: LiteKeyPair;
    let workerWallet: LiteKeyPair;
    let worker: LiteKeyPair;
    let workerLicense: AssetWithProof;
    let revenueSource: LiteKeyPair;

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

    describe('Revenue Deposits', () => {
        it('should correctly split revenue between community pool and worker wallet', async () => {
            // Create pool with 30% base, 20% addon
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

            // Deposit 1000 USDC
            const revenueAmount = usdcToBaseUnits(1000);
            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);

            const initialWorkerBalance = await lite.getTokenBalance(USDC_MINT, workerWallet.address);

            await depositRevenue(revenueAmount, 5);

            // Verify pool collected amounts
            // Base: 30% of 1000 = 300 USDC
            // Addon: 20% of 1000 = 200 USDC
            // Total community: 500 USDC
            // Worker: 500 USDC
            const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            const poolData = lite.getAccountData(poolPda);
            const pool = MonthlyPoolAccount.deserializeFrom(poolData!);

            expect(pool.base_pool.collected).toBe(usdcToBaseUnits(300));
            expect(pool.addon_pool.collected).toBe(usdcToBaseUnits(200));

            // Verify worker wallet received remainder
            const finalWorkerBalance = await lite.getTokenBalance(USDC_MINT, workerWallet.address);
            expect(finalWorkerBalance - initialWorkerBalance).toBe(usdcToBaseUnits(500));
        });

        it('should handle multiple revenue deposits in same month', async () => {
            const pools: MonthlyPoolConfig[] = [{
                month_period: 5,
                base_revenue_percentage: 2000, // 20%
                addon_revenue_percentage: 1000, // 10%
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

            // Deposit revenue 3 times: 500 USDC each
            const revenueAmount = usdcToBaseUnits(500);
            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount * 3n, tokenAuthorities.usdcMintAuthority);

            const initialWorkerBalance = await lite.getTokenBalance(USDC_MINT, workerWallet.address);

            await depositRevenue(revenueAmount, 5);
            await depositRevenue(revenueAmount, 5);
            await depositRevenue(revenueAmount, 5);

            // Verify accumulated revenue (3 × 20% × 500 = 300 USDC base, 3 × 10% × 500 = 150 USDC addon)
            const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            const poolData = lite.getAccountData(poolPda);
            const pool = MonthlyPoolAccount.deserializeFrom(poolData!);

            expect(pool.base_pool.collected).toBe(usdcToBaseUnits(300));
            expect(pool.addon_pool.collected).toBe(usdcToBaseUnits(150));

            // Verify worker received remainders: 3 × (500 - 100 - 50) = 3 × 350 = 1050 USDC
            const finalWorkerBalance = await lite.getTokenBalance(USDC_MINT, workerWallet.address);
            expect(finalWorkerBalance - initialWorkerBalance).toBe(usdcToBaseUnits(1050));
        });

        it('should send full revenue to worker when no pool exists', async () => {
            // No pool created, deposit revenue directly
            const revenueAmount = usdcToBaseUnits(1000);
            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);

            const initialWorkerBalance = await lite.getTokenBalance(USDC_MINT, workerWallet.address);

            // Deposit without pool
            const depositRev = new DepositRevenue({
                revenue_source: revenueSource.address,
                worker_collection: workerCollection,
                worker_wallet: workerWallet.address,
                total_revenue: revenueAmount,
                current_month_period: 5,
                has_monthly_pool: false,
            });

            lite.buildTransaction()
                .addInstruction(await depositRev.getInstruction())
                .sendTransaction({ payer: revenueSource });

            // Verify full amount went to worker
            const finalWorkerBalance = await lite.getTokenBalance(USDC_MINT, workerWallet.address);
            expect(finalWorkerBalance - initialWorkerBalance).toBe(revenueAmount);
        });

        it('should handle zero addon revenue percentage', async () => {
            const pools: MonthlyPoolConfig[] = [{
                month_period: 5,
                base_revenue_percentage: 2000, // 20%
                addon_revenue_percentage: 0,    // 0%
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

            const revenueAmount = usdcToBaseUnits(1000);
            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);

            const initialWorkerBalance = await lite.getTokenBalance(USDC_MINT, workerWallet.address);

            await depositRevenue(revenueAmount, 5);

            // Verify only base pool collected
            const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            const poolData = lite.getAccountData(poolPda);
            const pool = MonthlyPoolAccount.deserializeFrom(poolData!);

            expect(pool.base_pool.collected).toBe(usdcToBaseUnits(200));
            expect(pool.addon_pool.collected).toBe(0n);

            // Worker gets 800 USDC
            const finalWorkerBalance = await lite.getTokenBalance(USDC_MINT, workerWallet.address);
            expect(finalWorkerBalance - initialWorkerBalance).toBe(usdcToBaseUnits(800));
        });
    });

    describe('Emissions Deposits', () => {
        it('should correctly split emissions between community pool and worker wallet', async () => {
            const pools: MonthlyPoolConfig[] = [{
                month_period: 5,
                base_revenue_percentage: 2000,
                addon_revenue_percentage: 1000,
                base_emission_percentage: 1500, // 15%
            }];

            const setPool = new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools,
            });

            lite.buildTransaction()
                .addInstruction(await setPool.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Deposit 1000 BMB emissions
            const emissionAmount = bmbToBaseUnits(1000);
            await lite.mintToken(BMB_MINT, revenueSource.address, emissionAmount, tokenAuthorities.bmbMintAuthority);

            const initialWorkerBalance = await lite.getTokenBalance(BMB_MINT, workerWallet.address);

            await depositEmissions(emissionAmount, 5);

            // Verify pool collected: 15% of 1000 = 150 BMB
            const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            const poolData = lite.getAccountData(poolPda);
            const pool = MonthlyPoolAccount.deserializeFrom(poolData!);

            expect(pool.collected_bmb_base).toBe(bmbToBaseUnits(150));

            // Verify worker received remainder: 850 BMB
            const finalWorkerBalance = await lite.getTokenBalance(BMB_MINT, workerWallet.address);
            expect(finalWorkerBalance - initialWorkerBalance).toBe(bmbToBaseUnits(850));
        });

        it('should handle multiple emissions deposits in current month', async () => {
            const pools: MonthlyPoolConfig[] = [{
                month_period: 5,
                base_revenue_percentage: 2000,
                addon_revenue_percentage: 1000,
                base_emission_percentage: 2000, // 20%
            }];

            const setPool = new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools,
            });

            lite.buildTransaction()
                .addInstruction(await setPool.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Deposit emissions 3 times: 500 BMB each
            const emissionAmount = bmbToBaseUnits(500);
            await lite.mintToken(BMB_MINT, revenueSource.address, emissionAmount * 3n, tokenAuthorities.bmbMintAuthority);

            const initialWorkerBalance = await lite.getTokenBalance(BMB_MINT, workerWallet.address);

            await depositEmissions(emissionAmount, 5);
            await depositEmissions(emissionAmount, 5);
            await depositEmissions(emissionAmount, 5);

            // Verify accumulated emissions: 3 × 20% × 500 = 300 BMB
            const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            const poolData = lite.getAccountData(poolPda);
            const pool = MonthlyPoolAccount.deserializeFrom(poolData!);

            expect(pool.collected_bmb_base).toBe(bmbToBaseUnits(300));

            // Worker received: 3 × 400 = 1200 BMB
            const finalWorkerBalance = await lite.getTokenBalance(BMB_MINT, workerWallet.address);
            expect(finalWorkerBalance - initialWorkerBalance).toBe(bmbToBaseUnits(1200));
        });

        it('should prevent duplicate emissions deposits for past months', async () => {
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

            const emissionAmount = bmbToBaseUnits(500);
            await lite.mintToken(BMB_MINT, revenueSource.address, emissionAmount * 2n, tokenAuthorities.bmbMintAuthority);

            // Deposit for month 5
            await depositEmissions(emissionAmount, 5);

            // Move to month 6
            lite.goToMonthPeriod(6);

            // Try to deposit again for month 5 (should fail)
            await expect(async () => {
                await depositEmissions(emissionAmount, 5);
            }).rejects.toThrow("Emissions already deposited for past month");
        });

        it('should send full emissions to worker when no pool exists', async () => {
            const emissionAmount = bmbToBaseUnits(1000);
            await lite.mintToken(BMB_MINT, revenueSource.address, emissionAmount, tokenAuthorities.bmbMintAuthority);

            const initialWorkerBalance = await lite.getTokenBalance(BMB_MINT, workerWallet.address);

            // Deposit without pool
            const depositEmiss = new DepositEmissions({
                depositor: revenueSource.address,
                worker_collection: workerCollection,
                worker_wallet: workerWallet.address,
                month_period: 5,
                amount: emissionAmount,
                has_monthly_pool: false,
            });

            lite.buildTransaction()
                .addInstruction(await depositEmiss.getInstruction())
                .sendTransaction({ payer: revenueSource });

            // Verify full amount went to worker
            const finalWorkerBalance = await lite.getTokenBalance(BMB_MINT, workerWallet.address);
            expect(finalWorkerBalance - initialWorkerBalance).toBe(emissionAmount);
        });

        it('should reject emissions deposit for future month', async () => {
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

            const emissionAmount = bmbToBaseUnits(500);
            await lite.mintToken(BMB_MINT, revenueSource.address, emissionAmount, tokenAuthorities.bmbMintAuthority);

            // Try to deposit for month 6 (future month)
            await expect(async () => {
                await depositEmissions(emissionAmount, 6);
            }).rejects.toThrow("Cannot deposit emissions for future month");
        });
    });

    describe('Combined Deposits', () => {
        it('should handle both revenue and emissions deposits in same month', async () => {
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

            lite.buildTransaction()
                .addInstruction(await setPool.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Deposit revenue and emissions
            const revenueAmount = usdcToBaseUnits(1000);
            const emissionAmount = bmbToBaseUnits(500);

            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await lite.mintToken(BMB_MINT, revenueSource.address, emissionAmount, tokenAuthorities.bmbMintAuthority);

            const initialWorkerUSDC = await lite.getTokenBalance(USDC_MINT, workerWallet.address);
            const initialWorkerBMB = await lite.getTokenBalance(BMB_MINT, workerWallet.address);

            await depositRevenue(revenueAmount, 5);
            await depositEmissions(emissionAmount, 5);

            // Verify pool collected amounts
            const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            const poolData = lite.getAccountData(poolPda);
            const pool = MonthlyPoolAccount.deserializeFrom(poolData!);

            expect(pool.base_pool.collected).toBe(usdcToBaseUnits(200));
            expect(pool.addon_pool.collected).toBe(usdcToBaseUnits(100));
            expect(pool.collected_bmb_base).toBe(bmbToBaseUnits(75));

            // Verify worker balances
            const finalWorkerUSDC = await lite.getTokenBalance(USDC_MINT, workerWallet.address);
            const finalWorkerBMB = await lite.getTokenBalance(BMB_MINT, workerWallet.address);

            expect(finalWorkerUSDC - initialWorkerUSDC).toBe(usdcToBaseUnits(700));
            expect(finalWorkerBMB - initialWorkerBMB).toBe(bmbToBaseUnits(425));
        });
    });

});
