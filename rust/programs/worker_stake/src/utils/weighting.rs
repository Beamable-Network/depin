use crate::{state::PoolMetricsWeighted, state::UserStakePosition, utils::calculate_points};
use depin_core::utils::bmb::days_between;
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
    target_month: u16,
    month_start: i64,
    month_end: i64,
    days_in_month: u64,
) -> Result<MonthWeightTotals, ProgramError> {
    let mut stake_days: u64 = 0;
    let mut point_days: u64 = 0;

    let mut cumulative_stake: u64 = 0;
    let mut last_checker_count: u16 = 0;
    let mut last_timestamp: i64 = month_start;

    for entry in position.stake_entries.iter() {
        if entry.month_period < target_month {
            let full_month_weight = calculate_time_weighted(entry.amount, days_in_month)?;
            stake_days = stake_days
                .checked_add(full_month_weight)
                .ok_or(ProgramError::ArithmeticOverflow)?;

            cumulative_stake = cumulative_stake
                .checked_add(entry.amount)
                .ok_or(ProgramError::ArithmeticOverflow)?;
            last_checker_count = entry.checker_count;
            continue;
        }

        if entry.month_period > target_month {
            break;
        }

        let days_before = days_between(last_timestamp, entry.timestamp).max(0) as u64;
        if days_before > 0 {
            let points_before = calculate_points(last_checker_count, cumulative_stake);
            point_days = point_days
                .checked_add(
                    points_before
                        .checked_mul(days_before)
                        .ok_or(ProgramError::ArithmeticOverflow)?,
                )
                .ok_or(ProgramError::ArithmeticOverflow)?;
        }

        let days_active = days_between(entry.timestamp, month_end).max(0) as u64;
        if days_active > 0 {
            let weighted_amount = calculate_time_weighted(entry.amount, days_active)?;
            stake_days = stake_days
                .checked_add(weighted_amount)
                .ok_or(ProgramError::ArithmeticOverflow)?;
        }

        cumulative_stake = cumulative_stake
            .checked_add(entry.amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        last_checker_count = entry.checker_count;
        last_timestamp = entry.timestamp;
    }

    let final_points = calculate_points(last_checker_count, cumulative_stake);
    let final_days = days_between(last_timestamp, month_end).max(0) as u64;
    if final_days > 0 && final_points > 0 {
        point_days = point_days
            .checked_add(
                final_points
                    .checked_mul(final_days)
                    .ok_or(ProgramError::ArithmeticOverflow)?,
            )
            .ok_or(ProgramError::ArithmeticOverflow)?;
    }

    Ok(MonthWeightTotals {
        stake_days,
        point_days,
    })
}
