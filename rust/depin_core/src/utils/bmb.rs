use solana_program::{clock::Clock, entrypoint::ProgramResult, pubkey::Pubkey, sysvar::Sysvar};
#[cfg(not(feature = "test"))]
use solana_program::{msg, program_error::ProgramError};

#[cfg(not(feature = "test"))]
use crate::constants::{CHECKER_TREE, WORKER_TREE};

/// Seconds in a day
pub const SECONDS_PER_DAY: i64 = 86_400;

/// Unix timestamp for period zero: 2025-06-01 00:00:00 UTC
const PERIOD_ZERO: i64 = 1_748_736_000;

// Calendar algorithm constants (Howard Hinnant's civil calendar algorithm)
/// Days from Unix epoch (1970-01-01) to 2025-06-01
const DAYS_1970_TO_PERIOD_ZERO: i64 = 20_240;
/// Offset to convert Unix days to proleptic Gregorian calendar days
const CIVIL_EPOCH_OFFSET: i64 = 719_468;
/// Days in a 400-year Gregorian cycle (97 leap years)
const DAYS_IN_400_YEARS: i64 = 146_097;
/// Days in a 100-year period (24 leap years)
const DAYS_IN_100_YEARS: i64 = 36_524;
/// Days in a 4-year period (1 leap year)
const DAYS_IN_4_YEARS: i64 = 1_460;
/// Years in a Gregorian cycle
const YEARS_IN_CYCLE: i64 = 400;
/// Multiplier for month-day calculation: (5 × day_of_year + 2) / 153
const MONTH_DAY_DIVISOR: i64 = 153;
/// Base year for period calculations
const BASE_YEAR: i64 = 2025;
/// Base month offset (June = month 6, 0-indexed = 5)
const BASE_MONTH_OFFSET: i64 = 5;
/// Months in a year
const MONTHS_PER_YEAR: i64 = 12;

#[inline(always)]
pub fn get_current_period() -> u16 {
    let clock = Clock::get().expect("Clock sysvar not found.");
    let now = clock.unix_timestamp;
    if now < PERIOD_ZERO {
        return 0;
    }
    
    let seconds_since_start = now - PERIOD_ZERO;
    let days_since_start = seconds_since_start / SECONDS_PER_DAY;

    if days_since_start > u16::MAX as i64 {
        panic!("Period exceeds u16::MAX");
    }
    
    days_since_start as u16
}

#[inline(always)]
pub fn get_current_month_period() -> u16 {
    get_month_from_period(get_current_period())
}

#[inline(always)]
pub fn timestamp_to_period(timestamp: i64) -> u16 {
    if timestamp < PERIOD_ZERO {
        return 0;
    }
    
    let seconds_since_start = timestamp - PERIOD_ZERO;
    let days_since_start = seconds_since_start / SECONDS_PER_DAY;

    if days_since_start > u16::MAX as i64 {
        panic!("Period exceeds u16::MAX");
    }
    
    days_since_start as u16
}

pub fn get_month_from_period(period: u16) -> u16 {
    // Convert "period" (days since 2025-06-01) into days since 1970-01-01
    let mut z: i64 = DAYS_1970_TO_PERIOD_ZERO + period as i64;

    // --- civil_from_days (proleptic Gregorian), all integer math ---
    z += CIVIL_EPOCH_OFFSET;
    let era = if z >= 0 {
        z / DAYS_IN_400_YEARS
    } else {
        (z - (DAYS_IN_400_YEARS - 1)) / DAYS_IN_400_YEARS
    };
    let doe = z - era * DAYS_IN_400_YEARS; // [0, 146096]
    let yoe = (doe - doe / DAYS_IN_4_YEARS + doe / DAYS_IN_100_YEARS
        - doe / (DAYS_IN_400_YEARS - 1)) / 365; // [0, 399]
    let mut y = yoe + era * YEARS_IN_CYCLE; // year
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / MONTH_DAY_DIVISOR; // [0, 11]
    let m = mp + if mp < 10 { 3 } else { -9 }; // month [1..=12]
    if m <= 2 {
        y += 1;
    }

    // Month index where 2025-06 => 0, 2025-07 => 1, ...
    let month_index = (y - BASE_YEAR) * MONTHS_PER_YEAR + (m - (BASE_MONTH_OFFSET + 1));
    month_index as u16
}

pub fn validate_checker_tree(
    #[cfg_attr(feature = "test", allow(unused_variables))] merkle_tree: &Pubkey
) -> ProgramResult {
    #[cfg(not(feature = "test"))]
    if merkle_tree != &CHECKER_TREE {
        msg!("Error: Invalid checker tree");
        return Err(ProgramError::InvalidArgument);
    }
    Ok(())
}

pub fn validate_worker_tree(
    #[cfg_attr(feature = "test", allow(unused_variables))] merkle_tree: &Pubkey
) -> ProgramResult {
    #[cfg(not(feature = "test"))]
    if merkle_tree != &WORKER_TREE {
        msg!("Error: Invalid worker tree");
        return Err(ProgramError::InvalidArgument);
    }
    Ok(())
}

/// Returns the number of days in a given month period
///
/// # Arguments
/// * `month_period` - Months since June 2025 (0 = June 2025, 1 = July 2025, etc.)
///
/// # Returns
/// Number of days in the month (28, 29, 30, or 31)
#[inline]
pub fn days_in_month(month_period: u16) -> u8 {
    let month_offset = month_period as i64;
    let total_months = BASE_MONTH_OFFSET + month_offset;
    let year = BASE_YEAR + (total_months / MONTHS_PER_YEAR);
    let month = (total_months % MONTHS_PER_YEAR) + 1;

    match month {
        4 | 6 | 9 | 11 => 30,
        2 => if is_leap_year(year) { 29 } else { 28 },
        _ => 31,
    }
}

/// Returns Unix timestamp for the first second of a month (O(1))
/// Uses civil calendar arithmetic (Howard Hinnant's algorithm)
///
/// # Arguments
/// * `month_period` - Months since June 2025
///
/// # Returns
/// Unix timestamp (seconds since 1970-01-01 00:00:00 UTC)
pub fn get_month_start_timestamp(month_period: u16) -> i64 {
    if month_period == 0 {
        return PERIOD_ZERO;
    }

    // Convert month_period to calendar year and month
    let month_offset = month_period as i64;
    let total_months = BASE_MONTH_OFFSET + month_offset;
    let year = BASE_YEAR + (total_months / MONTHS_PER_YEAR);
    let month = (total_months % MONTHS_PER_YEAR) + 1;

    // Civil calendar algorithm: days_from_civil(year, month, 1)
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 {
        y / YEARS_IN_CYCLE
    } else {
        (y - (YEARS_IN_CYCLE - 1)) / YEARS_IN_CYCLE
    };
    let yoe = (y - era * YEARS_IN_CYCLE) as u32;
    let m_adj = if month > 2 { month - 3 } else { month + 9 } as u32;
    let doy = (MONTH_DAY_DIVISOR as u32 * m_adj + 2) / 5;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days_since_epoch = era * DAYS_IN_400_YEARS + doe as i64 - CIVIL_EPOCH_OFFSET;

    days_since_epoch * SECONDS_PER_DAY
}

/// Returns Unix timestamp for the exclusive end of a month
/// (first second of the next month)
///
/// # Arguments
/// * `month_period` - Months since June 2025
///
/// # Returns
/// Unix timestamp marking the start of the next month (exclusive boundary)
#[inline]
pub fn get_month_end_timestamp(month_period: u16) -> i64 {
    get_month_start_timestamp(month_period)
        + (days_in_month(month_period) as i64 * SECONDS_PER_DAY)
}

/// Calculates the number of complete days between two timestamps
///
/// # Arguments
/// * `start` - Earlier timestamp (seconds since epoch)
/// * `end` - Later timestamp (seconds since epoch)
///
/// # Returns
/// Number of complete days (floor division). Can be negative if end < start.
#[inline(always)]
pub fn days_between(start: i64, end: i64) -> i64 {
    (end - start) / SECONDS_PER_DAY
}

/// Check if a year is a leap year
///
/// # Arguments
/// * `year` - Calendar year
///
/// # Returns
/// true if leap year, false otherwise
#[inline(always)]
fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_days_in_month_basic() {
        assert_eq!(days_in_month(0), 30);   // June 2025
        assert_eq!(days_in_month(1), 31);   // July 2025
        assert_eq!(days_in_month(2), 31);   // August 2025
        assert_eq!(days_in_month(3), 30);   // September 2025
        assert_eq!(days_in_month(4), 31);   // October 2025
        assert_eq!(days_in_month(5), 30);   // November 2025
        assert_eq!(days_in_month(6), 31);   // December 2025
    }

    #[test]
    fn test_days_in_month_year_boundary() {
        assert_eq!(days_in_month(7), 31);   // January 2026
        assert_eq!(days_in_month(8), 28);   // February 2026 (not leap)
        assert_eq!(days_in_month(12), 30);  // June 2026
    }

    #[test]
    fn test_days_in_month_leap_years() {
        // February 2026 (not leap year)
        assert_eq!(days_in_month(8), 28);

        // February 2027 (not leap year)
        assert_eq!(days_in_month(20), 28);

        // February 2028 (leap year - divisible by 4)
        assert_eq!(days_in_month(32), 29);

        // February 2100 (not leap year - divisible by 100 but not 400)
        // month_period = (2100 - 2025) * 12 + (2 - 6) = 75 * 12 - 4 = 896
        assert_eq!(days_in_month(896), 28);
    }

    #[test]
    fn test_leap_year_rules() {
        assert!(!is_leap_year(2025));  // Not divisible by 4
        assert!(!is_leap_year(2026));  // Not divisible by 4
        assert!(!is_leap_year(2027));  // Not divisible by 4
        assert!(is_leap_year(2028));   // Divisible by 4
        assert!(!is_leap_year(2100));  // Divisible by 100 but not 400
        assert!(is_leap_year(2000));   // Divisible by 400
        assert!(is_leap_year(2400));   // Divisible by 400
    }

    #[test]
    fn test_get_month_start_timestamp_zero() {
        // month_period = 0 should be June 1, 2025 00:00:00 UTC
        assert_eq!(get_month_start_timestamp(0), PERIOD_ZERO);
        assert_eq!(get_month_start_timestamp(0), 1748736000);
    }

    #[test]
    fn test_get_month_start_timestamp_progression() {
        // June 2025 (30 days)
        let june_start = get_month_start_timestamp(0);
        assert_eq!(june_start, PERIOD_ZERO);

        // July 2025 = June + 30 days
        let july_start = get_month_start_timestamp(1);
        assert_eq!(july_start, june_start + (30 * SECONDS_PER_DAY));

        // August 2025 = July + 31 days
        let aug_start = get_month_start_timestamp(2);
        assert_eq!(aug_start, july_start + (31 * SECONDS_PER_DAY));

        // September 2025 = August + 31 days
        let sep_start = get_month_start_timestamp(3);
        assert_eq!(sep_start, aug_start + (31 * SECONDS_PER_DAY));
    }

    #[test]
    fn test_get_month_start_timestamp_year_boundary() {
        // December 2025 (month_period = 6)
        let dec_2025 = get_month_start_timestamp(6);

        // January 2026 (month_period = 7) = December + 31 days
        let jan_2026 = get_month_start_timestamp(7);
        assert_eq!(jan_2026, dec_2025 + (31 * SECONDS_PER_DAY));

        // February 2026 (month_period = 8) = January + 31 days
        let feb_2026 = get_month_start_timestamp(8);
        assert_eq!(feb_2026, jan_2026 + (31 * SECONDS_PER_DAY));
    }

    #[test]
    fn test_get_month_end_exclusive_boundary() {
        // End of June = Start of July
        assert_eq!(
            get_month_end_timestamp(0),
            get_month_start_timestamp(1)
        );

        // End of July = Start of August
        assert_eq!(
            get_month_end_timestamp(1),
            get_month_start_timestamp(2)
        );

        // End of December 2025 = Start of January 2026
        assert_eq!(
            get_month_end_timestamp(6),
            get_month_start_timestamp(7)
        );
    }

    #[test]
    fn test_get_month_end_duration() {
        // June has 30 days
        let june_start = get_month_start_timestamp(0);
        let june_end = get_month_end_timestamp(0);
        assert_eq!(june_end - june_start, 30 * SECONDS_PER_DAY);

        // July has 31 days
        let july_start = get_month_start_timestamp(1);
        let july_end = get_month_end_timestamp(1);
        assert_eq!(july_end - july_start, 31 * SECONDS_PER_DAY);

        // February 2026 has 28 days (not leap year)
        let feb_2026_start = get_month_start_timestamp(8);
        let feb_2026_end = get_month_end_timestamp(8);
        assert_eq!(feb_2026_end - feb_2026_start, 28 * SECONDS_PER_DAY);

        // February 2028 has 29 days (leap year)
        let feb_2028_start = get_month_start_timestamp(32);
        let feb_2028_end = get_month_end_timestamp(32);
        assert_eq!(feb_2028_end - feb_2028_start, 29 * SECONDS_PER_DAY);
    }

    #[test]
    fn test_days_between_full_days() {
        let day1 = PERIOD_ZERO;                       // June 1, 2025 00:00:00
        let day2 = day1 + SECONDS_PER_DAY;            // June 2, 2025 00:00:00
        let day30 = day1 + (29 * SECONDS_PER_DAY);    // June 30, 2025 00:00:00

        assert_eq!(days_between(day1, day2), 1);
        assert_eq!(days_between(day1, day30), 29);
        assert_eq!(days_between(day1, day1), 0);
    }

    #[test]
    fn test_days_between_partial_days() {
        let day1 = PERIOD_ZERO;
        let day1_noon = day1 + (SECONDS_PER_DAY / 2);      // 12 hours later
        let day2 = day1 + SECONDS_PER_DAY;
        let day2_6pm = day2 + (SECONDS_PER_DAY * 3 / 4);   // 18 hours into day 2

        // Partial day floors to 0
        assert_eq!(days_between(day1, day1_noon), 0);

        // 12 hours + 18 hours = 30 hours = 1 day (floor)
        assert_eq!(days_between(day1_noon, day2_6pm), 1);
    }

    #[test]
    fn test_days_between_negative() {
        let day1 = PERIOD_ZERO;
        let day2 = day1 + SECONDS_PER_DAY;

        // If end < start, result is negative
        assert_eq!(days_between(day2, day1), -1);
    }

    #[test]
    fn test_time_weighted_calculation_scenario() {
        // Simulate TDD stake scenario: staking on June 16, 2025
        let current_month = 0;  // June 2025
        let stake_timestamp = PERIOD_ZERO + (15 * SECONDS_PER_DAY);  // Day 16 (0-indexed = 15)

        let month_end = get_month_end_timestamp(current_month);
        let days_remaining = days_between(stake_timestamp, month_end);
        let total_days = days_in_month(current_month) as i64;

        // June has 30 days, staking on day 16 means days 16-30 = 15 days
        assert_eq!(total_days, 30);
        assert_eq!(days_remaining, 15);

        // Weight calculation (using u128 per TDD)
        let amount = 10_000u64;
        let weighted = ((amount as u128)
            * (days_remaining as u128)
            / (total_days as u128)) as u64;

        // 10,000 * 15 / 30 = 5,000
        assert_eq!(weighted, 5_000);
    }

    #[test]
    fn test_time_weighted_edge_case_last_day() {
        // Stake on last day of month
        let current_month = 0;  // June 2025
        let last_day = get_month_end_timestamp(current_month) - SECONDS_PER_DAY;  // June 30 00:00:00

        let month_end = get_month_end_timestamp(current_month);
        let days_remaining = days_between(last_day, month_end);

        // Should have exactly 1 day remaining
        assert_eq!(days_remaining, 1);

        // Weight should be minimal
        let amount = 10_000u64;
        let total_days = days_in_month(current_month) as i64;
        let weighted = ((amount as u128)
            * (days_remaining as u128)
            / (total_days as u128)) as u64;

        // 10,000 * 1 / 30 = 333 (floor)
        assert_eq!(weighted, 333);
    }

    #[test]
    fn test_time_weighted_edge_case_first_day() {
        // Stake on first day of month
        let current_month = 0;  // June 2025
        let first_day = get_month_start_timestamp(current_month);

        let month_end = get_month_end_timestamp(current_month);
        let days_remaining = days_between(first_day, month_end);
        let total_days = days_in_month(current_month) as i64;

        // Should have all 30 days
        assert_eq!(days_remaining, 30);

        // Weight should be full amount
        let amount = 10_000u64;
        let weighted = ((amount as u128)
            * (days_remaining as u128)
            / (total_days as u128)) as u64;

        // 10,000 * 30 / 30 = 10,000 (full weight)
        assert_eq!(weighted, 10_000);
    }

    #[test]
    fn test_integration_with_existing_functions() {
        // Verify consistency between month_period and get_month_from_period
        for month_period in 0..24 {
            let start_ts = get_month_start_timestamp(month_period);
            let period = timestamp_to_period(start_ts);

            // The period should correspond to the first day of the month
            let calculated_month = get_month_from_period(period);
            assert_eq!(calculated_month, month_period,
                "Mismatch for month_period {}: start_ts={}, period={}, calculated_month={}",
                month_period, start_ts, period, calculated_month);
        }
    }

    #[test]
    fn test_month_boundaries_alignment() {
        // Verify that consecutive months connect properly
        for month_period in 0..23 {
            let current_end = get_month_end_timestamp(month_period);
            let next_start = get_month_start_timestamp(month_period + 1);

            assert_eq!(current_end, next_start,
                "Month boundary mismatch between month {} and {}",
                month_period, month_period + 1);
        }
    }

    #[test]
    fn test_days_in_month_sum_year() {
        // Sum of days in 12 months should equal days in that year

        // 2025 (not leap year) - June to May = 365 days
        let mut total_2025 = 0u32;
        for month_period in 0..12 {  // June 2025 to May 2026
            total_2025 += days_in_month(month_period) as u32;
        }
        assert_eq!(total_2025, 365);

        // Year starting June 2027 to May 2028 (includes leap Feb 2028)
        let mut total_with_leap = 0u32;
        for month_period in 24..36 {  // June 2027 to May 2028
            total_with_leap += days_in_month(month_period) as u32;
        }
        assert_eq!(total_with_leap, 366);
    }
}
