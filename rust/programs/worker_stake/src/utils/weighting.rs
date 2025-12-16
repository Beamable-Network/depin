use crate::{state::PoolMetricsWeighted, state::UserStakePosition, utils::calculate_points};
use depin_core::utils::bmb::{days_between, days_in_month, get_month_end_timestamp};
use solana_program::{msg, program_error::ProgramError};

/// Weighted totals for a specific month derived from a user's stake entries.
pub struct MonthWeightTotals {
    pub stake_days: u64,
    pub point_days: u64,
}

/// Calculates the time-weighted contribution for a given amount and number of active days.
pub fn calculate_time_weighted(amount: u64, days_active: u64) -> Result<u64, ProgramError> {
    (amount as u128)
        .checked_mul(days_active as u128)
        .and_then(|result| {
            if result > u64::MAX as u128 {
                None
            } else {
                Some(result as u64)
            }
        })
        .ok_or_else(|| {
            msg!("Error: Arithmetic overflow in time-weighted calculation");
            ProgramError::ArithmeticOverflow
        })
}

/// Applies a new stake to the base pool, updating totals and weighted totals.
pub fn apply_base_stake_weight(
    base_pool: &mut PoolMetricsWeighted,
    amount: u64,
    days_active: u64,
) -> Result<(), ProgramError> {
    let weighted_amount = calculate_time_weighted(amount, days_active)?;

    base_pool.total = base_pool
        .total
        .checked_add(amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    base_pool.total_weighted = base_pool
        .total_weighted
        .checked_add(weighted_amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    Ok(())
}

/// Applies the change in addon points to the addon pool, handling increases and decreases.
pub fn apply_addon_point_weight(
    addon_pool: &mut PoolMetricsWeighted,
    previous_points: u64,
    new_points: u64,
    days_active: u64,
) -> Result<(), ProgramError> {
    let delta = new_points as i64 - previous_points as i64;
    if delta == 0 {
        return Ok(());
    }

    let delta_abs = delta.unsigned_abs();
    let weighted_delta = calculate_time_weighted(delta_abs, days_active)?;

    if delta > 0 {
        addon_pool.total = addon_pool
            .total
            .checked_add(delta as u64)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        addon_pool.total_weighted = addon_pool
            .total_weighted
            .checked_add(weighted_delta)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    } else {
        addon_pool.total = addon_pool
            .total
            .checked_sub(delta_abs)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        addon_pool.total_weighted = addon_pool.total_weighted.saturating_sub(weighted_delta);
    }

    Ok(())
}

/// Computes stake-days and point-days for a user during the target month.
pub fn compute_month_weight_totals(
    position: &UserStakePosition,
    target_month: u16
) -> Result<MonthWeightTotals, ProgramError> {
    let month_end = get_month_end_timestamp(target_month);
    let days_in_month_val = days_in_month(target_month) as u64;

    let mut stake_days: u64 = 0;
    let mut point_days: u64 = 0;

    let mut cumulative_stake: u64 = 0;
    let mut last_points: u64 = 0;

    // First loop: Process all previous months
    for entry in position.stake_entries.iter() {
        if entry.month_period < target_month {
            let full_month_stake_days = calculate_time_weighted(entry.amount, days_in_month_val)?;
            stake_days = stake_days
                .checked_add(full_month_stake_days)
                .ok_or(ProgramError::ArithmeticOverflow)?;
            cumulative_stake = cumulative_stake
                .checked_add(entry.amount)
                .ok_or(ProgramError::ArithmeticOverflow)?;
            last_points = calculate_points(entry.checker_count, cumulative_stake);
        }
    }

    // Apply inheritance from previous months
    if last_points > 0 {
        let inherited_point_days = calculate_time_weighted(last_points, days_in_month_val)?;
        point_days = point_days
            .checked_add(inherited_point_days)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    }

    // Second loop: Process target month entries (apply deltas)
    for entry in position.stake_entries.iter() {
        if entry.month_period == target_month {
            let days_left = days_between(entry.timestamp, month_end).max(0) as u64;

            let weighted_stake_days = calculate_time_weighted(entry.amount, days_left)?;
            stake_days = stake_days
                .checked_add(weighted_stake_days)
                .ok_or(ProgramError::ArithmeticOverflow)?;
            cumulative_stake = cumulative_stake
                .checked_add(entry.amount)
                .ok_or(ProgramError::ArithmeticOverflow)?;

            let new_points = calculate_points(entry.checker_count, cumulative_stake);
            let points_delta = new_points as i64 - last_points as i64;
            if points_delta != 0 {
                let delta_abs = points_delta.unsigned_abs();
                let weighted_delta = calculate_time_weighted(delta_abs, days_left)?;

                if points_delta > 0 {
                    point_days = point_days
                        .checked_add(weighted_delta)
                        .ok_or(ProgramError::ArithmeticOverflow)?;
                } else {
                    point_days = point_days.saturating_sub(weighted_delta);
                }
                last_points = new_points;
            }
        }
    }

    Ok(MonthWeightTotals {
        stake_days,
        point_days,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{StakeEntry, UserStakePosition};
    use depin_core::constants::BMB_DECIMALS;
    use depin_core::utils::bmb::{get_month_start_timestamp, get_month_end_timestamp};
    use solana_program::pubkey::Pubkey;

    const DAY_SECONDS: i64 = 86_400;
    const MONTH_DAYS: u64 = 30;

    fn bmb(amount: u64) -> u64 {
        amount * 10_u64.pow(BMB_DECIMALS as u32)
    }

    #[test]
    fn compute_weights_common() {
        let target_month: u16 = 5;
        let month_start = get_month_start_timestamp(target_month);

        let position = UserStakePosition {
            user: Pubkey::new_unique(),
            worker_collection: Pubkey::new_unique(),
            staked_amount: bmb(5_000) + bmb(2_500),
            stake_entries: vec![
                StakeEntry { // Day 1
                    amount: bmb(5_000),
                    timestamp: month_start,
                    month_period: target_month,
                    checker_count: 2,
                },
                StakeEntry { // Day 15
                    amount: bmb(5_000),
                    timestamp: month_start + DAY_SECONDS * 15,
                    month_period: target_month,
                    checker_count: 3,
                }
            ],
            opted_out_at_month_period: 0,
            last_claimed_month_period: 0,
        };

        let totals = compute_month_weight_totals(
            &position,
            target_month
        )
        .unwrap();

        let expected_stake_days = bmb(5_000) * MONTH_DAYS + bmb(5_000) * 15;

        assert_eq!(totals.stake_days, expected_stake_days);
        // Delta-based: 2 points for 30 days + 1 point delta for 15 days = 60 + 15 = 75
        assert_eq!(totals.point_days, 75);
    }

    #[test]
    fn compute_weights_with_mid_month_stake() {
        let target_month: u16 = 5;
        let month_start = get_month_start_timestamp(target_month);
        let prev_month_start = get_month_start_timestamp(target_month - 1);

        let position = UserStakePosition {
            user: Pubkey::new_unique(),
            worker_collection: Pubkey::new_unique(),
            staked_amount: bmb(5_000) + bmb(2_500),
            stake_entries: vec![
                StakeEntry {
                    amount: bmb(5_000),
                    timestamp: prev_month_start,
                    month_period: target_month - 1,
                    checker_count: 2,
                },
                StakeEntry {
                    amount: bmb(2_500),
                    timestamp: month_start + 10 * DAY_SECONDS,
                    month_period: target_month,
                    checker_count: 3,
                },
            ],
            opted_out_at_month_period: 0,
            last_claimed_month_period: 0,
        };

        let totals = compute_month_weight_totals(
            &position,
            target_month
        )
        .unwrap();

        let expected_stake_days = bmb(5_000) * MONTH_DAYS + bmb(2_500) * 20;

        assert_eq!(totals.stake_days, expected_stake_days);
        // Inherit 2 points for 30 days + delta of 1 point for 20 days = 60 + 20 = 80
        assert_eq!(totals.point_days, 80);
    }

    #[test]
    fn compute_weights_with_last_day_stake() {
        let target_month: u16 = 2;
        let month_end = get_month_end_timestamp(target_month);

        let position = UserStakePosition {
            user: Pubkey::new_unique(),
            worker_collection: Pubkey::new_unique(),
            staked_amount: bmb(3_000),
            stake_entries: vec![StakeEntry {
                amount: bmb(3_000),
                timestamp: month_end - 1, // stake at the very end of the month
                month_period: target_month,
                checker_count: 2,
            }],
            opted_out_at_month_period: 0,
            last_claimed_month_period: 0,
        };

        let totals =
            compute_month_weight_totals(&position, target_month).unwrap();

        assert_eq!(totals.stake_days, 0);
        assert_eq!(totals.point_days, 0);
    }
}
