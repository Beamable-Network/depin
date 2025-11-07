/**
 * Reward Calculation Tests
 *
 * This test file demonstrates how to calculate user reward shares for the UI.
 * It covers various scenarios including:
 * - Basic stake rewards (base pool)
 * - Points-based rewards (addon pool)
 * - Mid-month staking (prorated rewards)
 * - Multiple users sharing a pool
 *
 * Each test shows the calculation step-by-step with clear comments.
 */

import {
    baseUnitsToBmb,
    bmbToBaseUnits,
    calculateUserRewardShare,
    getMonthStartTimestamp,
    MonthlyPoolAccount,
    UserStakePositionAccount,
} from '@beamable-network/depin';
import { address } from 'gill';
import { describe, expect, it } from 'vitest';

// Helper to convert USDC to base units (6 decimals)
function usdcToBaseUnits(amount: number): bigint {
    return BigInt(Math.floor(amount * 10 ** 6));
}

// Helper to convert base units back to human-readable USDC
function baseUnitsToUsdc(amount: bigint): number {
    return Number(amount) / 10 ** 6;
}

describe('Reward Calculation Examples for UI', () => {

    /**
     * SCENARIO 1: Single User, Full Month Stake, Base Pool Only
     *
     * This is the simplest scenario:
     * - User stakes 5,000 BMB at the start of month 5
     * - Worker deposits 1,000 USDC in revenue (20% = 200 USDC goes to base pool)
     * - User has no checker licenses (no addon pool participation)
     * - User should receive 100% of the base pool (200 USDC)
     */
    it('Scenario 1: Single user gets 100% of base pool rewards', () => {
        console.log('\n=== SCENARIO 1: Single User, Full Month ===');

        // Setup: Month 5 has 30 days (can verify with daysInMonth function)
        const monthPeriod = 5;
        const daysInMonth = 30;
        const monthStart = getMonthStartTimestamp(monthPeriod);

        // User staked 5,000 BMB at the very start of the month
        const userPosition = new UserStakePositionAccount({
            user: address('User111111111111111111111111111111111111111'),
            worker_collection: address('Work111111111111111111111111111111111111111'),
            staked_amount: bmbToBaseUnits(5000),
            stake_entries: [
                {
                    amount: bmbToBaseUnits(5000),
                    timestamp: monthStart, // Start of month
                    month_period: 5,
                    checker_count: 0, // No checker licenses
                }
            ],
            opted_out_at_month_period: 0,
            last_claimed_month_period: 0,
        });

        // Pool received 1,000 USDC revenue, 20% goes to base pool = 200 USDC
        const monthlyPool = new MonthlyPoolAccount({
            worker_collection: address('Work111111111111111111111111111111111111111'),
            month_period: 5,
            base_revenue_percentage: 2000, // 20%
            addon_revenue_percentage: 1000, // 10%
            base_emission_percentage: 1500, // 15%
            initialized: true,
            base_pool: {
                total: bmbToBaseUnits(5000), // Total staked in base pool
                total_weighted: bmbToBaseUnits(5000) * BigInt(daysInMonth), // 5000 BMB × 30 days
                collected: usdcToBaseUnits(200), // 200 USDC collected
                total_opted_out: 0n,
            },
            addon_pool: {
                total: 0n, // No points (user has no checkers)
                total_weighted: 0n,
                collected: usdcToBaseUnits(100), // 100 USDC collected but not distributed
                total_opted_out: 0n,
            },
            collected_bmb_base: bmbToBaseUnits(50), // 50 BMB emissions
        });

        // Calculate the user's reward share
        const share = calculateUserRewardShare(userPosition, monthlyPool, monthPeriod);

        console.log('User staked: 5,000 BMB for full month (30 days)');
        console.log(`User stake-days: ${baseUnitsToBmb(share.userStakeDays)} (= 5000 × 30)`);
        console.log(`Total pool stake-days: ${baseUnitsToBmb(monthlyPool.base_pool.total_weighted)}`);
        console.log(`\nBase pool has: ${baseUnitsToUsdc(monthlyPool.base_pool.collected)} USDC`);
        console.log(`User's share: ${share.userStakeDays} / ${monthlyPool.base_pool.total_weighted} = 100%`);
        console.log(`User receives: ${baseUnitsToUsdc(share.usdcBaseReward)} USDC`);
        console.log(`User receives: ${baseUnitsToBmb(share.bmbBaseReward)} BMB`);

        // Assertions
        expect(share.userStakeDays).toBe(bmbToBaseUnits(5000) * BigInt(daysInMonth));
        expect(share.usdcBaseReward).toBe(usdcToBaseUnits(200)); // Gets all 200 USDC
        expect(share.bmbBaseReward).toBe(bmbToBaseUnits(50)); // Gets all 50 BMB
        expect(share.usdcAddonReward).toBe(0n); // No addon pool participation
        expect(share.totalUsdc).toBe(usdcToBaseUnits(200));
        expect(share.totalBmb).toBe(bmbToBaseUnits(50));
    });

    /**
     * SCENARIO 2: Two Users Sharing the Base Pool
     *
     * - User A stakes 3,000 BMB for full month
     * - User B stakes 7,000 BMB for full month
     * - Total: 10,000 BMB staked
     * - Pool has 1,000 USDC to distribute
     * - User A should get 30% (300 USDC)
     * - User B should get 70% (700 USDC)
     */
    it('Scenario 2: Two users share pool proportionally', () => {
        console.log('\n=== SCENARIO 2: Two Users Share Pool ===');

        const monthPeriod = 5;
        const daysInMonth = 30;
        const monthStart = getMonthStartTimestamp(monthPeriod);

        // User A: 3,000 BMB staked
        const userA = new UserStakePositionAccount({
            user: address('UserAAA111111111111111111111111111111111111'),
            worker_collection: address('Work111111111111111111111111111111111111111'),
            staked_amount: bmbToBaseUnits(3000),
            stake_entries: [
                {
                    amount: bmbToBaseUnits(3000),
                    timestamp: monthStart,
                    month_period: 5,
                    checker_count: 0,
                }
            ],
            opted_out_at_month_period: 0,
            last_claimed_month_period: 0,
        });

        // Combined pool state (both users)
        // Total: 3,000 + 7,000 = 10,000 BMB
        const totalStaked = bmbToBaseUnits(10000);
        const monthlyPool = new MonthlyPoolAccount({
            worker_collection: address('Work111111111111111111111111111111111111111'),
            month_period: 5,
            base_revenue_percentage: 2000,
            addon_revenue_percentage: 1000,
            base_emission_percentage: 1500,
            initialized: true,
            base_pool: {
                total: totalStaked,
                total_weighted: totalStaked * BigInt(daysInMonth), // 10,000 BMB × 30 days
                collected: usdcToBaseUnits(1000), // 1,000 USDC to distribute
                total_opted_out: 0n,
            },
            addon_pool: {
                total: 0n,
                total_weighted: 0n,
                collected: 0n,
                total_opted_out: 0n,
            },
            collected_bmb_base: bmbToBaseUnits(100), // 100 BMB emissions
        });

        const shareA = calculateUserRewardShare(userA, monthlyPool, monthPeriod);

        console.log('User A staked: 3,000 BMB (30% of total)');
        console.log('Total staked: 10,000 BMB');
        console.log(`User A stake-days: ${baseUnitsToBmb(shareA.userStakeDays)}`);
        console.log(`Total pool stake-days: ${baseUnitsToBmb(monthlyPool.base_pool.total_weighted)}`);
        console.log(`\nPool has: ${baseUnitsToUsdc(monthlyPool.base_pool.collected)} USDC`);
        console.log(`User A's share: ${shareA.userStakeDays} / ${monthlyPool.base_pool.total_weighted} = 30%`);
        console.log(`User A receives: ${baseUnitsToUsdc(shareA.totalUsdc)} USDC (= 1000 × 0.3)`);
        console.log(`User A receives: ${baseUnitsToBmb(shareA.totalBmb)} BMB (= 100 × 0.3)`);

        // User A should get 30% of rewards
        expect(shareA.usdcBaseReward).toBe(usdcToBaseUnits(300)); // 30% of 1,000
        expect(shareA.bmbBaseReward).toBe(bmbToBaseUnits(30)); // 30% of 100
        expect(shareA.totalUsdc).toBe(usdcToBaseUnits(300));
        expect(shareA.totalBmb).toBe(bmbToBaseUnits(30));
    });

    /**
     * SCENARIO 3: Mid-Month Staking (Prorated Rewards)
     *
     * - Month has 30 days
     * - User stakes 6,000 BMB on day 10 (20 days remaining)
     * - Pool has 900 USDC to distribute
     * - Another user has 6,000 BMB staked for full 30 days
     *
     * Calculation:
     * - User 1: 6,000 × 20 days = 120,000 stake-days
     * - User 2: 6,000 × 30 days = 180,000 stake-days
     * - Total: 300,000 stake-days
     * - User 1 gets: 120,000 / 300,000 = 40% = 360 USDC
     * - User 2 gets: 180,000 / 300,000 = 60% = 540 USDC
     */
    it('Scenario 3: Mid-month staking gets prorated rewards', () => {
        console.log('\n=== SCENARIO 3: Mid-Month Staking ===');

        const monthPeriod = 5;
        const daysInMonth = 30;
        const secondsPerDay = 86400;
        const monthStart = getMonthStartTimestamp(monthPeriod);

        // User stakes on day 10, so 20 days remaining in month
        const stakeTimestamp = monthStart + BigInt(10 * secondsPerDay);

        const user = new UserStakePositionAccount({
            user: address('User111111111111111111111111111111111111111'),
            worker_collection: address('Work111111111111111111111111111111111111111'),
            staked_amount: bmbToBaseUnits(6000),
            stake_entries: [
                {
                    amount: bmbToBaseUnits(6000),
                    timestamp: stakeTimestamp, // Day 10 of the month
                    month_period: 5,
                    checker_count: 0,
                }
            ],
            opted_out_at_month_period: 0,
            last_claimed_month_period: 0,
        });

        // Pool state: includes both users
        // User 1: 6,000 × 20 days = 120,000 stake-days
        // User 2: 6,000 × 30 days = 180,000 stake-days
        // Total: 300,000 stake-days
        const totalWeighted = bmbToBaseUnits(6000) * BigInt(20) + bmbToBaseUnits(6000) * BigInt(30);

        const monthlyPool = new MonthlyPoolAccount({
            worker_collection: address('Work111111111111111111111111111111111111111'),
            month_period: 5,
            base_revenue_percentage: 2000,
            addon_revenue_percentage: 1000,
            base_emission_percentage: 1500,
            initialized: true,
            base_pool: {
                total: bmbToBaseUnits(12000), // 6k + 6k
                total_weighted: totalWeighted,
                collected: usdcToBaseUnits(900), // 900 USDC to distribute
                total_opted_out: 0n,
            },
            addon_pool: {
                total: 0n,
                total_weighted: 0n,
                collected: 0n,
                total_opted_out: 0n,
            },
            collected_bmb_base: bmbToBaseUnits(90), // 90 BMB emissions
        });

        const share = calculateUserRewardShare(user, monthlyPool, monthPeriod);

        console.log('User staked: 6,000 BMB on day 10 (20 days remaining)');
        console.log(`User stake-days: ${baseUnitsToBmb(share.userStakeDays)} (= 6000 × 20)`);
        console.log(`Other user stake-days: ${baseUnitsToBmb(bmbToBaseUnits(6000) * BigInt(30))} (= 6000 × 30)`);
        console.log(`Total pool stake-days: ${baseUnitsToBmb(monthlyPool.base_pool.total_weighted)}`);
        console.log(`\nUser's share: ${baseUnitsToBmb(share.userStakeDays)} / ${baseUnitsToBmb(monthlyPool.base_pool.total_weighted)} = 40%`);
        console.log(`User receives: ${baseUnitsToUsdc(share.totalUsdc)} USDC (= 900 × 0.4)`);
        console.log(`User receives: ${baseUnitsToBmb(share.totalBmb)} BMB (= 90 × 0.4)`);

        // User should get 40% of rewards (20/50 of the time-weighted total)
        const expectedStakeDays = bmbToBaseUnits(6000) * BigInt(20);
        expect(share.userStakeDays).toBe(expectedStakeDays);
        expect(share.usdcBaseReward).toBe(usdcToBaseUnits(360)); // 40% of 900
        expect(share.bmbBaseReward).toBe(bmbToBaseUnits(36)); // 40% of 90
    });

    /**
     * SCENARIO 4: Points-Based Addon Pool Rewards
     *
     * This demonstrates the addon pool which uses "points" instead of stake amount.
     * Points = min(checker_licenses, floor(stake / 2500 BMB))
     *
     * - User has 2 checker licenses
     * - User stakes 10,000 BMB for full month
     * - Points = min(2, floor(10,000 / 2,500)) = min(2, 4) = 2 points
     * - Only the user participates in addon pool
     * - User gets 100% of addon pool rewards
     */
    it('Scenario 4: Points-based addon pool rewards', () => {
        console.log('\n=== SCENARIO 4: Addon Pool with Points ===');

        const monthPeriod = 5;
        const daysInMonth = 30;
        const monthStart = getMonthStartTimestamp(monthPeriod);

        const user = new UserStakePositionAccount({
            user: address('User111111111111111111111111111111111111111'),
            worker_collection: address('Work111111111111111111111111111111111111111'),
            staked_amount: bmbToBaseUnits(10000),
            stake_entries: [
                {
                    amount: bmbToBaseUnits(10000),
                    timestamp: monthStart,
                    month_period: 5,
                    checker_count: 2, // User has 2 checker licenses
                }
            ],
            opted_out_at_month_period: 0,
            last_claimed_month_period: 0,
        });

        // Points calculation: min(2 checkers, floor(10,000 / 2,500)) = min(2, 4) = 2 points
        // Point-days: 2 points × 30 days = 60 point-days
        const userPoints = 2n;
        const userPointDays = userPoints * BigInt(daysInMonth);

        const monthlyPool = new MonthlyPoolAccount({
            worker_collection: address('Work111111111111111111111111111111111111111'),
            month_period: 5,
            base_revenue_percentage: 2000, // 20%
            addon_revenue_percentage: 1000, // 10%
            base_emission_percentage: 1500, // 15%
            initialized: true,
            base_pool: {
                total: bmbToBaseUnits(10000),
                total_weighted: bmbToBaseUnits(10000) * BigInt(daysInMonth),
                collected: usdcToBaseUnits(400), // 400 USDC in base pool
                total_opted_out: 0n,
            },
            addon_pool: {
                total: userPoints, // 2 points total
                total_weighted: userPointDays, // 2 × 30 = 60 point-days
                collected: usdcToBaseUnits(200), // 200 USDC in addon pool
                total_opted_out: 0n,
            },
            collected_bmb_base: bmbToBaseUnits(100), // 100 BMB emissions
        });

        const share = calculateUserRewardShare(user, monthlyPool, monthPeriod);

        console.log('User has: 2 checker licenses, 10,000 BMB staked');
        console.log('Points calculation: min(2 checkers, floor(10,000 / 2,500)) = min(2, 4) = 2 points');
        console.log(`User point-days: ${share.userPointDays} (= 2 × 30)`);
        console.log(`\nBase pool rewards: ${baseUnitsToUsdc(share.usdcBaseReward)} USDC`);
        console.log(`Addon pool rewards: ${baseUnitsToUsdc(share.usdcAddonReward)} USDC`);
        console.log(`BMB emissions: ${baseUnitsToBmb(share.bmbBaseReward)} BMB`);
        console.log(`\nTotal USDC: ${baseUnitsToUsdc(share.totalUsdc)} USDC`);
        console.log(`Total BMB: ${baseUnitsToBmb(share.totalBmb)} BMB`);

        expect(share.userPointDays).toBe(userPointDays);
        expect(share.usdcBaseReward).toBe(usdcToBaseUnits(400)); // All of base pool
        expect(share.usdcAddonReward).toBe(usdcToBaseUnits(200)); // All of addon pool
        expect(share.bmbBaseReward).toBe(bmbToBaseUnits(100)); // All BMB emissions
        expect(share.totalUsdc).toBe(usdcToBaseUnits(600)); // 400 + 200
        expect(share.totalBmb).toBe(bmbToBaseUnits(100));
    });

    /**
     * SCENARIO 5: Multiple Stake Entries (Increasing Stake)
     *
     * Shows what happens when a user makes multiple stakes during the month:
     * - Day 0: Stakes 2,000 BMB (lasts 30 days) = 60,000 stake-days
     * - Day 15: Stakes 3,000 more BMB (lasts 15 days) = 45,000 stake-days
     * - Total contribution: 105,000 stake-days
     *
     * This is common when users add to their stake throughout the month.
     */
    it('Scenario 5: Multiple stake entries during the month', () => {
        console.log('\n=== SCENARIO 5: Multiple Stake Entries ===');

        const monthPeriod = 5;
        const daysInMonth = 30;
        const secondsPerDay = 86400;
        const monthStart = getMonthStartTimestamp(monthPeriod);

        const user = new UserStakePositionAccount({
            user: address('User111111111111111111111111111111111111111'),
            worker_collection: address('Work111111111111111111111111111111111111111'),
            staked_amount: bmbToBaseUnits(5000), // Total: 2,000 + 3,000
            stake_entries: [
                {
                    amount: bmbToBaseUnits(2000),
                    timestamp: monthStart, // Day 0
                    month_period: 5,
                    checker_count: 0,
                },
                {
                    amount: bmbToBaseUnits(3000),
                    timestamp: monthStart + BigInt(15 * secondsPerDay), // Day 15
                    month_period: 5,
                    checker_count: 0,
                }
            ],
            opted_out_at_month_period: 0,
            last_claimed_month_period: 0,
        });

        // Expected calculation:
        // Entry 1: 2,000 BMB × 30 days = 60,000 stake-days
        // Entry 2: 3,000 BMB × 15 days = 45,000 stake-days
        // Total: 105,000 stake-days
        const expectedStakeDays =
            bmbToBaseUnits(2000) * BigInt(30) +  // First stake
            bmbToBaseUnits(3000) * BigInt(15);   // Second stake

        // Pool: only this user
        const monthlyPool = new MonthlyPoolAccount({
            worker_collection: address('Work111111111111111111111111111111111111111'),
            month_period: 5,
            base_revenue_percentage: 2000,
            addon_revenue_percentage: 1000,
            base_emission_percentage: 1500,
            initialized: true,
            base_pool: {
                total: bmbToBaseUnits(5000),
                total_weighted: expectedStakeDays,
                collected: usdcToBaseUnits(500), // 500 USDC
                total_opted_out: 0n,
            },
            addon_pool: {
                total: 0n,
                total_weighted: 0n,
                collected: 0n,
                total_opted_out: 0n,
            },
            collected_bmb_base: bmbToBaseUnits(50), // 50 BMB
        });

        const share = calculateUserRewardShare(user, monthlyPool, monthPeriod);

        console.log('User makes two stakes:');
        console.log('  Day 0: 2,000 BMB (active for 30 days) = 60,000 stake-days');
        console.log('  Day 15: 3,000 BMB (active for 15 days) = 45,000 stake-days');
        console.log(`Total stake-days: ${baseUnitsToBmb(share.userStakeDays)}`);
        console.log(`\nUser receives: ${baseUnitsToUsdc(share.totalUsdc)} USDC (100% of pool)`);
        console.log(`User receives: ${baseUnitsToBmb(share.totalBmb)} BMB (100% of emissions)`);

        expect(share.userStakeDays).toBe(expectedStakeDays);
        expect(share.usdcBaseReward).toBe(usdcToBaseUnits(500));
        expect(share.bmbBaseReward).toBe(bmbToBaseUnits(50));
    });

    /**
     * SCENARIO 6: Points Capped by Insufficient Stake
     *
     * Demonstrates what happens when stake doesn't support all checker licenses:
     * - User has 5 checker licenses
     * - User stakes 7,500 BMB
     * - Points = min(5, floor(7,500 / 2,500)) = min(5, 3) = 3 points
     *
     * The user would need 12,500 BMB to activate all 5 licenses (5 × 2,500).
     */
    it('Scenario 6: Points capped by insufficient stake', () => {
        console.log('\n=== SCENARIO 6: Points Capped by Stake ===');

        const monthPeriod = 5;
        const daysInMonth = 30;
        const monthStart = getMonthStartTimestamp(monthPeriod);

        const user = new UserStakePositionAccount({
            user: address('User111111111111111111111111111111111111111'),
            worker_collection: address('Work111111111111111111111111111111111111111'),
            staked_amount: bmbToBaseUnits(7500),
            stake_entries: [
                {
                    amount: bmbToBaseUnits(7500),
                    timestamp: monthStart,
                    month_period: 5,
                    checker_count: 5, // 5 licenses, but only 3 are "activated"
                }
            ],
            opted_out_at_month_period: 0,
            last_claimed_month_period: 0,
        });

        // Points: min(5 checkers, floor(7,500 / 2,500)) = min(5, 3) = 3 points
        const actualPoints = 3n;
        const actualPointDays = actualPoints * BigInt(daysInMonth);

        const monthlyPool = new MonthlyPoolAccount({
            worker_collection: address('Work111111111111111111111111111111111111111'),
            month_period: 5,
            base_revenue_percentage: 2000,
            addon_revenue_percentage: 1000,
            base_emission_percentage: 1500,
            initialized: true,
            base_pool: {
                total: bmbToBaseUnits(7500),
                total_weighted: bmbToBaseUnits(7500) * BigInt(daysInMonth),
                collected: usdcToBaseUnits(300),
                total_opted_out: 0n,
            },
            addon_pool: {
                total: actualPoints,
                total_weighted: actualPointDays, // 3 × 30 = 90
                collected: usdcToBaseUnits(150),
                total_opted_out: 0n,
            },
            collected_bmb_base: bmbToBaseUnits(75),
        });

        const share = calculateUserRewardShare(user, monthlyPool, monthPeriod);

        console.log('User has: 5 checker licenses, 7,500 BMB staked');
        console.log('Points calculation: min(5 checkers, floor(7,500 / 2,500)) = min(5, 3) = 3 points');
        console.log('  → Only 3 out of 5 licenses are "activated"');
        console.log('  → Would need 12,500 BMB to activate all 5 (5 × 2,500)');
        console.log(`User point-days: ${share.userPointDays} (= 3 × 30)`);
        console.log(`\nBase pool: ${baseUnitsToUsdc(share.usdcBaseReward)} USDC`);
        console.log(`Addon pool: ${baseUnitsToUsdc(share.usdcAddonReward)} USDC`);
        console.log(`Total: ${baseUnitsToUsdc(share.totalUsdc)} USDC + ${baseUnitsToBmb(share.totalBmb)} BMB`);

        expect(share.userPointDays).toBe(actualPointDays);
        expect(share.usdcAddonReward).toBe(usdcToBaseUnits(150));
        expect(share.totalUsdc).toBe(usdcToBaseUnits(450)); // 300 + 150
    });

    /**
     * SCENARIO 7: Points Capped by Insufficient Checker Licenses
     *
     * The opposite of Scenario 6:
     * - User has 2 checker licenses
     * - User stakes 10,000 BMB (enough for 4 licenses)
     * - Points = min(2, floor(10,000 / 2,500)) = min(2, 4) = 2 points
     *
     * The extra stake doesn't give extra points without more licenses.
     */
    it('Scenario 7: Points capped by checker licenses', () => {
        console.log('\n=== SCENARIO 7: Points Capped by Licenses ===');

        const monthPeriod = 5;
        const daysInMonth = 30;
        const monthStart = getMonthStartTimestamp(monthPeriod);

        const user = new UserStakePositionAccount({
            user: address('User111111111111111111111111111111111111111'),
            worker_collection: address('Work111111111111111111111111111111111111111'),
            staked_amount: bmbToBaseUnits(10000),
            stake_entries: [
                {
                    amount: bmbToBaseUnits(10000),
                    timestamp: monthStart,
                    month_period: 5,
                    checker_count: 2, // Only 2 licenses
                }
            ],
            opted_out_at_month_period: 0,
            last_claimed_month_period: 0,
        });

        // Points: min(2 checkers, floor(10,000 / 2,500)) = min(2, 4) = 2 points
        const actualPoints = 2n;
        const actualPointDays = actualPoints * BigInt(daysInMonth);

        const monthlyPool = new MonthlyPoolAccount({
            worker_collection: address('Work111111111111111111111111111111111111111'),
            month_period: 5,
            base_revenue_percentage: 2000,
            addon_revenue_percentage: 1000,
            base_emission_percentage: 1500,
            initialized: true,
            base_pool: {
                total: bmbToBaseUnits(10000),
                total_weighted: bmbToBaseUnits(10000) * BigInt(daysInMonth),
                collected: usdcToBaseUnits(400),
                total_opted_out: 0n,
            },
            addon_pool: {
                total: actualPoints,
                total_weighted: actualPointDays, // 2 × 30 = 60
                collected: usdcToBaseUnits(200),
                total_opted_out: 0n,
            },
            collected_bmb_base: bmbToBaseUnits(100),
        });

        const share = calculateUserRewardShare(user, monthlyPool, monthPeriod);

        console.log('User has: 2 checker licenses, 10,000 BMB staked');
        console.log('Points calculation: min(2 checkers, floor(10,000 / 2,500)) = min(2, 4) = 2 points');
        console.log('  → Stake could support 4 points, but user only has 2 licenses');
        console.log('  → Extra 5,000 BMB doesn\'t add more points without more licenses');
        console.log(`User point-days: ${share.userPointDays} (= 2 × 30)`);
        console.log(`\nBase pool: ${baseUnitsToUsdc(share.usdcBaseReward)} USDC`);
        console.log(`Addon pool: ${baseUnitsToUsdc(share.usdcAddonReward)} USDC`);

        expect(share.userPointDays).toBe(actualPointDays);
        expect(share.usdcAddonReward).toBe(usdcToBaseUnits(200));
        expect(share.totalUsdc).toBe(usdcToBaseUnits(600)); // 400 + 200
    });
});

/**
 * KEY TAKEAWAYS FOR UI IMPLEMENTATION:
 *
 * 1. CALCULATING REWARDS:
 *    Simply call calculateUserRewardShare(userPosition, monthlyPool, monthPeriod)
 *    This returns all the information you need to display.
 *
 * 2. BASE POOL (Stake-weighted):
 *    - Rewards proportional to stake × time
 *    - Mid-month stakes get prorated
 *    - Returns both USDC and BMB
 *
 * 3. ADDON POOL (Points-weighted):
 *    - Points = min(checker_licenses, floor(stake / 2,500 BMB))
 *    - User needs BOTH licenses AND sufficient stake
 *    - Only returns USDC (no BMB)
 *
 * 4. DISPLAYING TO USERS:
 *    - Show breakdown: base USDC, addon USDC, BMB emissions
 *    - Explain if points are capped (not enough stake or licenses)
 *    - Show time-weighted values (stake-days, point-days) for transparency
 *
 * 5. FETCHING DATA:
 *    - UserStakePositionAccount: User's stake history
 *    - MonthlyPoolAccount: Pool state with total rewards
 *    - Both can be deserialized from on-chain account data
 */
