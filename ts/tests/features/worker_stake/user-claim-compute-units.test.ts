/**
 * Compute Units Testing for Worker Stake Claim Rewards
 *
 * This test suite validates that the claim_rewards instruction is efficient
 * even when a user has the maximum allowed stake entries.
 * */

import {
    bmbToBaseUnits,
    InitializeWorkerStakeConfig,
    SetMonthlyPool,
    Stake,
    ClaimRewards,
    DepositRevenue,
    DepositEmissions,
    MonthlyPoolConfig,
    WorkerStakeConfigAccount,
    UserStakePositionAccount,
    WORKER_STAKE_PROGRAM,
    BMB_MINT,
    USDC_MINT
} from '@beamable-network/depin';
import { Address, address } from 'gill';
import { beforeEach, describe, expect, it } from 'vitest';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';
import { setupTokens, TokenAuthorities, usdcToBaseUnits } from '../../helpers/spl-tokens.js';
import { AssetWithProof } from '@metaplex-foundation/mpl-bubblegum';

/**
 * Parse compute units consumed from transaction logs
 * Looks for the Worker Stake program's compute units specifically
 * Pattern: "Program WSTKhDg9nQ8h2ZmnmNdR6heSGU6uYJSwdUNpzSYXBSe consumed <units> of <total> compute units"
 */
function parseComputeUnits(logs: string[]): number {
    // Look for the Worker Stake program's compute units (WSTKh...)
    // This is the top-level program, so it includes all nested calls
    for (const log of logs) {
        if (log.includes('WSTKhDg9nQ8h2ZmnmNdR6heSGU6uYJSwdUNpzSYXBSe consumed')) {
            const match = log.match(/consumed (\d+) of (\d+) compute units/);
            if (match) {
                return parseInt(match[1], 10);
            }
        }
    }
    throw new Error('Could not find Worker Stake program compute units in logs');
}

describe('User Claim Rewards - Compute Units Tests', async () => {
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

        if (config.last_active_pool_month > 0) {
            depositRev.previous_pool_month_period = config.last_active_pool_month;
        }

        lite.buildTransaction()
            .addInstruction(await depositRev.getInstruction())
            .sendTransaction({ payer: revenueSource });
    }

    // Helper to deposit emissions
    async function depositEmissions(amount: bigint, monthPeriod: number) {
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

        lite.buildTransaction()
            .addInstruction(await setPool.getInstruction())
            .sendTransaction({ payer: collectionCreator });
    });

    describe('Compute Units with Maximum Stake Entries', () => {
        it('should efficiently handle claiming with 25 stake entries (max limit)', async () => {
            // Create a user and stake 25 times in month 5 to create 25 stake entries
            const user = await lite.generateKeyPair();
            await lite.airdrop(user, 10);

            // Stake 25 times with different amounts and checker counts
            // This simulates a user who has been staking monthly for ~2 years
            const stakePerEntry = bmbToBaseUnits(1000);
            const totalStake = stakePerEntry * 25n;
            await lite.mintToken(BMB_MINT, user.address, totalStake, tokenAuthorities.bmbMintAuthority);

            // Query config to get last_active_pool_month before staking
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            let configData = lite.getAccountData(configPda);
            let config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            // Create 25 stake entries with varying checker counts
            for (let i = 0; i < 25; i++) {
                // Vary checker count: 0, 1, 2, 3, 4 cycling
                const checkerCount = i % 5;

                const stake = new Stake({
                    user: user.address,
                    worker: worker.address,
                    worker_license: workerLicense,
                    worker_collection: workerCollection,
                    amount: stakePerEntry,
                    checker_count: checkerCount,
                    current_month_period: 5,
                });

                // Only set previous pool if last_active_pool_month exists and is different from current
                if (config.last_active_pool_month > 0 && config.last_active_pool_month !== 5) {
                    stake.previous_pool_month_period = config.last_active_pool_month;
                }

                lite.buildTransaction()
                    .addInstruction(await stake.getInstruction())
                    .sign(user)
                    .sendTransaction({ payer: worker });

                // Refresh config for next iteration
                configData = lite.getAccountData(configPda);
                config = WorkerStakeConfigAccount.deserializeFrom(configData!);
            }

            // Verify 25 entries were created
            const [userPositionPda] = await UserStakePositionAccount.findUserStakePositionPDA(user.address, workerCollection);
            let positionData = lite.getAccountData(userPositionPda);
            let position = UserStakePositionAccount.deserializeFrom(positionData!);

            expect(position.stake_entries).toHaveLength(25);
            expect(position.staked_amount).toBe(totalStake);

            console.log(`\n✓ Created user position with ${position.stake_entries.length} stake entries`);
            console.log(`  Total staked: ${position.staked_amount.toString()} base units (${position.staked_amount / bmbToBaseUnits(1)} BMB)`);

            // Deposit revenue and emissions for month 5
            const revenueAmount = usdcToBaseUnits(10000); // 10,000 USDC
            const emissionAmount = bmbToBaseUnits(5000); // 5,000 BMB

            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            await lite.mintToken(BMB_MINT, revenueSource.address, emissionAmount, tokenAuthorities.bmbMintAuthority);
            await depositEmissions(emissionAmount, 5);

            // Advance to month 6 (after month 5 ends) to allow claiming
            lite.goToMonthPeriod(6);

            // Claim rewards and measure compute units
            const claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            const result = lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // Parse compute units from logs
            const computeUnits = parseComputeUnits(result.logs);

            console.log(`\n📊 Compute Units Analysis:`);
            console.log(`  Stake entries processed: 25`);
            console.log(`  Compute units consumed: ${computeUnits.toLocaleString()}`);
            console.log(`  Max compute units (limit): 1,400,000`);
            console.log(`  Usage percentage: ${((computeUnits / 1_400_000) * 100).toFixed(2)}%`);

            // Print full logs for debugging
            console.log(`\n📝 Transaction logs:`);
            result.logs.forEach(log => console.log(`  ${log}`));

            // Assert that compute units are reasonable
            // Solana has a default compute unit limit of 1.4M per transaction
            // We should use significantly less than this even with 25 entries
            const MAX_COMPUTE_UNITS = 1_400_000;
            const REASONABLE_LIMIT = MAX_COMPUTE_UNITS * 0.5; // 50% of max (conservative)

            expect(computeUnits).toBeLessThan(REASONABLE_LIMIT);
            console.log(`\n✓ Compute units (${computeUnits.toLocaleString()}) are within reasonable limits (< ${REASONABLE_LIMIT.toLocaleString()})`);

            // Verify rewards were actually claimed correctly
            positionData = lite.getAccountData(userPositionPda);
            position = UserStakePositionAccount.deserializeFrom(positionData!);
            expect(position.last_claimed_month_period).toBe(5);

            // Verify user received rewards
            const usdcBalance = await lite.getTokenBalance(USDC_MINT, user.address);
            const bmbBalance = await lite.getTokenBalance(BMB_MINT, user.address);

            console.log(`\n💰 Rewards claimed:`);
            console.log(`  USDC: ${usdcBalance.toString()} base units`);
            console.log(`  BMB: ${bmbBalance.toString()} base units`);

            expect(usdcBalance).toBeGreaterThan(0n);
            expect(bmbBalance).toBeGreaterThan(0n);
        });

        it('should compare compute units: 1 entry vs 25 entries', async () => {
            // Test 1: User with single stake entry
            const user1 = await lite.generateKeyPair();
            await lite.airdrop(user1, 5);

            const singleStakeAmount = bmbToBaseUnits(25000); // Same total as 25x1000
            await lite.mintToken(BMB_MINT, user1.address, singleStakeAmount, tokenAuthorities.bmbMintAuthority);

            const stake1 = new Stake({
                user: user1.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: singleStakeAmount,
                checker_count: 10, // 10 checkers, full points
                current_month_period: 5,
            });

            lite.buildTransaction()
                .addInstruction(await stake1.getInstruction())
                .sign(user1)
                .sendTransaction({ payer: worker });

            // Test 2: User with 25 stake entries
            const user2 = await lite.generateKeyPair();
            await lite.airdrop(user2, 10);

            const stakePerEntry = bmbToBaseUnits(1000);
            const totalStake = stakePerEntry * 25n;
            await lite.mintToken(BMB_MINT, user2.address, totalStake, tokenAuthorities.bmbMintAuthority);

            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            let configData = lite.getAccountData(configPda);
            let config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            for (let i = 0; i < 25; i++) {
                const checkerCount = i % 5;

                const stake2 = new Stake({
                    user: user2.address,
                    worker: worker.address,
                    worker_license: workerLicense,
                    worker_collection: workerCollection,
                    amount: stakePerEntry,
                    checker_count: checkerCount,
                    current_month_period: 5,
                });

                if (config.last_active_pool_month > 0 && config.last_active_pool_month !== 5) {
                    stake2.previous_pool_month_period = config.last_active_pool_month;
                }

                lite.buildTransaction()
                    .addInstruction(await stake2.getInstruction())
                    .sign(user2)
                    .sendTransaction({ payer: worker });

                configData = lite.getAccountData(configPda);
                config = WorkerStakeConfigAccount.deserializeFrom(configData!);
            }

            // Deposit revenue and emissions
            const revenueAmount = usdcToBaseUnits(10000);
            const emissionAmount = bmbToBaseUnits(5000);

            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 5);

            await lite.mintToken(BMB_MINT, revenueSource.address, emissionAmount, tokenAuthorities.bmbMintAuthority);
            await depositEmissions(emissionAmount, 5);

            // Advance to month 6
            lite.goToMonthPeriod(6);

            // Claim for user1 (1 entry)
            const claim1 = new ClaimRewards({
                user: user1.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            const result1 = lite.buildTransaction()
                .addInstruction(await claim1.getInstruction())
                .sendTransaction({ payer: user1 });

            const computeUnits1 = parseComputeUnits(result1.logs);

            // Claim for user2 (25 entries)
            const claim2 = new ClaimRewards({
                user: user2.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            const result2 = lite.buildTransaction()
                .addInstruction(await claim2.getInstruction())
                .sendTransaction({ payer: user2 });

            const computeUnits2 = parseComputeUnits(result2.logs);

            // Compare compute units
            const increase = computeUnits2 - computeUnits1;
            const increasePercentage = ((increase / computeUnits1) * 100).toFixed(2);

            console.log(`\n📊 Compute Units Comparison:`);
            console.log(`  User 1 (1 stake entry):    ${computeUnits1.toLocaleString()} CU`);
            console.log(`  User 2 (25 stake entries): ${computeUnits2.toLocaleString()} CU`);
            console.log(`  Difference:                ${increase.toLocaleString()} CU (+${increasePercentage}%)`);
            console.log(`  Cost per additional entry: ~${Math.round(increase / 24).toLocaleString()} CU`);

            // Verify both are under reasonable limits
            const MAX_COMPUTE_UNITS = 1_400_000;
            const REASONABLE_LIMIT = MAX_COMPUTE_UNITS * 0.5;

            expect(computeUnits1).toBeLessThan(REASONABLE_LIMIT);
            expect(computeUnits2).toBeLessThan(REASONABLE_LIMIT);

            // The increase should be linear and reasonable
            // 25 entries should not be exponentially more expensive than 1 entry
            const MAXIMUM_REASONABLE_INCREASE = 5; // Max 5x increase for 25x entries
            expect(computeUnits2 / computeUnits1).toBeLessThan(MAXIMUM_REASONABLE_INCREASE);

            console.log(`\n✓ Both scenarios are within reasonable compute limits`);
            console.log(`✓ Scaling is linear (25x entries = ${(computeUnits2 / computeUnits1).toFixed(2)}x compute)`);
        });

        it('should handle 25 stake entries across multiple months with inheritance', async () => {
            // Create pools for months 5-7
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

            lite.buildTransaction()
                .addInstruction(await setPool.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Create user and make stakes across months to get 25 entries
            const user = await lite.generateKeyPair();
            await lite.airdrop(user, 10);

            const totalStake = bmbToBaseUnits(25000);
            await lite.mintToken(BMB_MINT, user.address, totalStake, tokenAuthorities.bmbMintAuthority);

            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);

            // Month 5: 10 stakes
            for (let i = 0; i < 10; i++) {
                let configData = lite.getAccountData(configPda);
                let config = WorkerStakeConfigAccount.deserializeFrom(configData!);

                const stake = new Stake({
                    user: user.address,
                    worker: worker.address,
                    worker_license: workerLicense,
                    worker_collection: workerCollection,
                    amount: bmbToBaseUnits(1000),
                    checker_count: i % 5,
                    current_month_period: 5,
                });

                if (config.last_active_pool_month > 0 && config.last_active_pool_month !== 5) {
                    stake.previous_pool_month_period = config.last_active_pool_month;
                }

                lite.buildTransaction()
                    .addInstruction(await stake.getInstruction())
                    .sign(user)
                    .sendTransaction({ payer: worker });
            }

            // Advance to month 6: 10 more stakes
            lite.goToMonthPeriod(6);

            for (let i = 0; i < 10; i++) {
                let configData = lite.getAccountData(configPda);
                let config = WorkerStakeConfigAccount.deserializeFrom(configData!);

                const stake = new Stake({
                    user: user.address,
                    worker: worker.address,
                    worker_license: workerLicense,
                    worker_collection: workerCollection,
                    amount: bmbToBaseUnits(1000),
                    checker_count: i % 5,
                    current_month_period: 6,
                });

                if (config.last_active_pool_month > 0 && config.last_active_pool_month !== 6) {
                    stake.previous_pool_month_period = config.last_active_pool_month;
                }

                lite.buildTransaction()
                    .addInstruction(await stake.getInstruction())
                    .sign(user)
                    .sendTransaction({ payer: worker });
            }

            // Advance to month 7: 5 more stakes (total 25)
            lite.goToMonthPeriod(7);

            for (let i = 0; i < 5; i++) {
                let configData = lite.getAccountData(configPda);
                let config = WorkerStakeConfigAccount.deserializeFrom(configData!);

                const stake = new Stake({
                    user: user.address,
                    worker: worker.address,
                    worker_license: workerLicense,
                    worker_collection: workerCollection,
                    amount: bmbToBaseUnits(1000),
                    checker_count: i % 5,
                    current_month_period: 7,
                });

                if (config.last_active_pool_month > 0 && config.last_active_pool_month !== 7) {
                    stake.previous_pool_month_period = config.last_active_pool_month;
                }

                lite.buildTransaction()
                    .addInstruction(await stake.getInstruction())
                    .sign(user)
                    .sendTransaction({ payer: worker });
            }

            // Verify 25 entries total
            const [userPositionPda] = await UserStakePositionAccount.findUserStakePositionPDA(user.address, workerCollection);
            let positionData = lite.getAccountData(userPositionPda);
            let position = UserStakePositionAccount.deserializeFrom(positionData!);

            expect(position.stake_entries).toHaveLength(25);

            // Count entries per month
            const month5Entries = position.stake_entries.filter(e => e.month_period === 5).length;
            const month6Entries = position.stake_entries.filter(e => e.month_period === 6).length;
            const month7Entries = position.stake_entries.filter(e => e.month_period === 7).length;

            console.log(`\n📅 Stake entries distribution:`);
            console.log(`  Month 5: ${month5Entries} entries`);
            console.log(`  Month 6: ${month6Entries} entries`);
            console.log(`  Month 7: ${month7Entries} entries`);
            console.log(`  Total:   ${position.stake_entries.length} entries`);

            // Deposit revenue for month 7
            const revenueAmount = usdcToBaseUnits(10000);
            const emissionAmount = bmbToBaseUnits(5000);

            await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
            await depositRevenue(revenueAmount, 7);

            await lite.mintToken(BMB_MINT, revenueSource.address, emissionAmount, tokenAuthorities.bmbMintAuthority);
            await depositEmissions(emissionAmount, 7);

            // Advance to month 8 to allow claiming
            lite.goToMonthPeriod(8);

            // Claim month 5, 6, 7 sequentially
            const computeResults: { month: number; computeUnits: number }[] = [];

            for (const month of [5, 6, 7]) {
                const claimRewards = new ClaimRewards({
                    user: user.address,
                    worker_collection: workerCollection,
                    month_period: month,
                });

                const result = lite.buildTransaction()
                    .addInstruction(await claimRewards.getInstruction())
                    .sendTransaction({ payer: user });

                const computeUnits = parseComputeUnits(result.logs);
                computeResults.push({ month, computeUnits });
            }

            console.log(`\n📊 Compute units per month claim:`);
            computeResults.forEach(({ month, computeUnits }) => {
                console.log(`  Month ${month}: ${computeUnits.toLocaleString()} CU`);
            });

            // All claims should be within reasonable limits
            const MAX_COMPUTE_UNITS = 1_400_000;
            const REASONABLE_LIMIT = MAX_COMPUTE_UNITS * 0.5;

            computeResults.forEach(({ month, computeUnits }) => {
                expect(computeUnits).toBeLessThan(REASONABLE_LIMIT);
            });

            console.log(`\n✓ All monthly claims with 25 total entries are within reasonable limits`);
        });
    });
});
