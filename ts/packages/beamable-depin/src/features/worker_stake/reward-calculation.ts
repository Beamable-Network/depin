import { BMB_DECIMALS } from "../../constants.js";
import { daysBetween, daysInMonth, getMonthEndTimestamp } from "../../utils/bmb.js";
import { MonthlyPoolAccount } from "./monthly-pool-account.js";
import { UserStakePositionAccount } from "./user-stake-position-account.js";

/**
 * BMB tokens required per checker point (for addon pool eligibility)
 * Points = min(checker_count, floor(staked_bmb / BMB_PER_POINT))
 * This is 2500 BMB in base units
 */
export const BMB_PER_POINT = 2_500n * 10n ** BigInt(BMB_DECIMALS);

/**
 * Weighted totals for a specific month derived from a user's stake entries.
 */
export interface MonthWeightTotals {
    /**
     * Time-weighted stake amount (sum of amount * days_active for each stake entry)
     */
    stakeDays: bigint;

    /**
     * Time-weighted points (sum of points * days_active)
     */
    pointDays: bigint;
}

/**
 * Calculates addon pool points based on checker count and total stake
 *
 * Points are used for addon pool reward distribution. A user earns points
 * based on the minimum of:
 * 1. Their checker license count
 * 2. Their total stake divided by BMB_PER_POINT (2500 BMB per point)
 *
 * This ensures users must stake sufficient BMB to "activate" each checker license.
 *
 * This mirrors the Rust function calculate_points.
 *
 * @param checkerCount - Number of checker licenses the user owns
 * @param totalStake - Total BMB staked by the user (in base units)
 * @returns The number of points earned (min of checker_count and stake-based points)
 *
 * @example
 * // User has 3 licenses and 7500 BMB staked
 * // 7500 / 2500 = 3 points from stake
 * // min(3, 3) = 3 points
 * calculatePoints(3, 7_500n * 10n**9n) // => 3n
 *
 * @example
 * // User has 5 licenses but only 10000 BMB staked
 * // 10000 / 2500 = 4 points from stake
 * // min(5, 4) = 4 points (capped by stake)
 * calculatePoints(5, 10_000n * 10n**9n) // => 4n
 *
 * @example
 * // User has 2 licenses but 10000 BMB staked
 * // 10000 / 2500 = 4 points from stake
 * // min(2, 4) = 2 points (capped by licenses)
 * calculatePoints(2, 10_000n * 10n**9n) // => 2n
 */
export function calculatePoints(checkerCount: number, totalStake: bigint): bigint {
    return BigInt(checkerCount) < totalStake / BMB_PER_POINT
        ? BigInt(checkerCount)
        : totalStake / BMB_PER_POINT;
}

/**
 * Calculates the time-weighted contribution for a given amount and number of active days.
 *
 * @param amount - The stake amount or points
 * @param daysActive - Number of days the amount was active
 * @returns The time-weighted value (amount * daysActive)
 * @throws Error if arithmetic overflow occurs
 */
function calculateTimeWeighted(amount: bigint, daysActive: bigint): bigint {
    const result = amount * daysActive;

    // Check for overflow (simplified check in JS/TS since we don't have u64 limits)
    if (result < 0n) {
        throw new Error("Arithmetic overflow in time-weighted calculation");
    }

    return result;
}

/**
 * Computes stake-days and point-days for a user during the target month.
 *
 * This function iterates through a user's stake entries and calculates:
 * - stakeDays: Time-weighted stake (sum of amount * days active in the month)
 * - pointDays: Time-weighted points (sum of points * days active in the month)
 *
 * The calculation handles:
 * - Entries from previous months (get full month weight)
 * - Mid-month stake additions (prorated by remaining days)
 * - Multiple checker licenses (affects points calculation)
 *
 * This mirrors the Rust function compute_month_weight_totals.
 *
 * @param position - The user's stake position containing all stake entries
 * @param targetMonth - The month period to calculate weights for
 * @returns MonthWeightTotals containing stakeDays and pointDays
 * @throws Error if arithmetic overflow occurs
 */
export function computeMonthWeightTotals(
    position: UserStakePositionAccount,
    targetMonth: number,
): MonthWeightTotals {
    const monthEnd = getMonthEndTimestamp(targetMonth);
    const daysInMonthVal = daysInMonth(targetMonth);
    
    let stakeDays = 0n;
    let pointDays = 0n;
    
    let cumulativeStake = 0n;
    let lastPoints = 0n;
    let appliedInheritedPoints = false;
    
    for (const entry of position.stake_entries) {
        // Previous months
        if (entry.month_period < targetMonth) {
            const fullMonthStakeDays = calculateTimeWeighted(entry.amount, BigInt(daysInMonthVal));
            stakeDays += fullMonthStakeDays;
            cumulativeStake += entry.amount;
            lastPoints = calculatePoints(entry.checker_count, cumulativeStake);
        }
        // Target month
        else if (entry.month_period == targetMonth) {
            const daysLeft = daysBetween(entry.timestamp, monthEnd);
            
            const weightedStakeDays = calculateTimeWeighted(entry.amount, daysLeft);
            stakeDays += weightedStakeDays;
            cumulativeStake += entry.amount;
            
            // Point inheritance
            if (!appliedInheritedPoints) {
                if (lastPoints > 0n) {
                    const points = calculatePoints(Number(lastPoints), cumulativeStake);
                    pointDays += calculateTimeWeighted(points, BigInt(daysInMonthVal));
                }
                appliedInheritedPoints = true;
            }

            const newPoints = calculatePoints(entry.checker_count, cumulativeStake);
            const pointsDelta = newPoints - lastPoints;
            if (pointsDelta != 0n) {
                if (pointsDelta > 0n)
                    pointDays += calculateTimeWeighted(pointsDelta, daysLeft);
                else
                    pointDays -= calculateTimeWeighted(pointsDelta * -1n, daysLeft);
                lastPoints = newPoints;
            }
        }
    }

    return {
        pointDays,
        stakeDays
    };
}

/**
 * Result of user reward share calculation
 */
export interface UserRewardShare {
    /**
     * User's time-weighted stake (stake-days)
     */
    userStakeDays: bigint;

    /**
     * User's time-weighted points (point-days)
     */
    userPointDays: bigint;

    /**
     * Expected USDC reward from base pool (stake-weighted)
     */
    usdcBaseReward: bigint;

    /**
     * Expected USDC reward from addon pool (points-weighted)
     */
    usdcAddonReward: bigint;

    /**
     * Expected BMB reward from base emissions
     */
    bmbBaseReward: bigint;

    /**
     * Total expected USDC reward
     */
    totalUsdc: bigint;

    /**
     * Total expected BMB reward
     */
    totalBmb: bigint;
}

/**
 * Calculates the user's expected reward share for a specific month.
 *
 * This function computes:
 * 1. User's time-weighted stake (stake-days) and points (point-days)
 * 2. User's proportional share of the monthly pool rewards:
 *    - Base USDC: (pool.base_pool.collected * user_stake_days) / pool.base_pool.total_weighted
 *    - Addon USDC: (pool.addon_pool.collected * user_point_days) / pool.addon_pool.total_weighted
 *    - Base BMB: (pool.collected_bmb_base * user_stake_days) / pool.base_pool.total_weighted
 *
 * This mirrors the reward calculation logic in claim_rewards.rs lines 185-232.
 *
 * @param userPosition - The user's stake position
 * @param monthlyPool - The monthly pool to calculate rewards from
 * @param monthPeriod - The month period to calculate for
 * @returns UserRewardShare containing all calculated values
 *
 * @example
 * const share = calculateUserRewardShare(userPosition, monthlyPool, 5);
 * console.log(`Expected USDC: ${share.totalUsdc}`);
 * console.log(`Expected BMB: ${share.totalBmb}`);
 * console.log(`User stake-days: ${share.userStakeDays}`);
 * console.log(`User point-days: ${share.userPointDays}`);
 */
export function calculateUserRewardShare(
    userPosition: UserStakePositionAccount,
    monthlyPool: MonthlyPoolAccount
): UserRewardShare {
    // Compute user's time-weighted contributions
    const totals = computeMonthWeightTotals(
        userPosition,
        monthlyPool.month_period
    );

    const totalStakeDays = totals.stakeDays;
    const totalPointDays = totals.pointDays;

    // Calculate base pool rewards (stake-days weighted)
    let usdcBaseReward = 0n;
    if (monthlyPool.base_pool.total_weighted > 0n && totalStakeDays > 0n) {
        usdcBaseReward = (monthlyPool.base_pool.collected * totalStakeDays) / monthlyPool.base_pool.total_weighted;
    }

    let bmbBaseReward = 0n;
    if (monthlyPool.base_pool.total_weighted > 0n && totalStakeDays > 0n) {
        bmbBaseReward = (monthlyPool.collected_bmb_base * totalStakeDays) / monthlyPool.base_pool.total_weighted;
    }

    // Calculate addon pool rewards (points-based, WITH time-weighting) - USDC only
    let usdcAddonReward = 0n;
    if (monthlyPool.addon_pool.total_weighted > 0n && totalPointDays > 0n) {
        usdcAddonReward = (monthlyPool.addon_pool.collected * totalPointDays) / monthlyPool.addon_pool.total_weighted;
    }

    // Total rewards
    const totalUsdc = usdcBaseReward + usdcAddonReward;
    const totalBmb = bmbBaseReward;

    return {
        userStakeDays: totalStakeDays,
        userPointDays: totalPointDays,
        usdcBaseReward,
        usdcAddonReward,
        bmbBaseReward,
        totalUsdc,
        totalBmb
    };
}
