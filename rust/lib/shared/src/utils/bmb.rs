use solana_program::{clock::Clock, entrypoint::ProgramResult, pubkey::Pubkey, sysvar::Sysvar};
#[cfg(not(feature = "test"))]
use solana_program::{msg, program_error::ProgramError};

#[cfg(not(feature = "test"))]
use crate::constants::accounts::{CHECKER_TREE, WORKER_TREE};
const PERIOD_ZERO: i64 = 1748736000; // 2025-06-01 00:00:00 UTC

#[inline(always)]
pub fn get_current_period() -> u16 {
    let clock = Clock::get().expect("Clock sysvar not found.");    
    let now = clock.unix_timestamp;    
    if now < PERIOD_ZERO {
        return 0;
    }
    
    let seconds_since_start = now - PERIOD_ZERO;
    let days_since_start = seconds_since_start / 86400;

    if days_since_start > u16::MAX as i64 {
        panic!("Period exceeds u16::MAX");
    }
    
    days_since_start as u16
}

#[inline(always)]
pub fn timestamp_to_period(timestamp: i64) -> u16 {
    if timestamp < PERIOD_ZERO {
        return 0;
    }
    
    let seconds_since_start = timestamp - PERIOD_ZERO;
    let days_since_start = seconds_since_start / 86400;

    if days_since_start > u16::MAX as i64 {
        panic!("Period exceeds u16::MAX");
    }
    
    days_since_start as u16
}

pub fn get_month_from_period(period: u16) -> u16 {
    const DAYS_1970_TO_2025_06_01: i64 = 20_240;

    // Convert "period" (days since 2025-06-01) into days since 1970-01-01
    let mut z: i64 = DAYS_1970_TO_2025_06_01 + period as i64;

    // --- civil_from_days (proleptic Gregorian), all integer math ---
    z += 719_468;
    let era = if z >= 0 { z / 146_097 } else { (z - 146_096) / 146_097 };
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let mut y = yoe + era * 400; // year
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let m = mp + if mp < 10 { 3 } else { -9 }; // month [1..=12]
    if m <= 2 { y += 1; }

    // Month index where 2025-06 => 0, 2025-07 => 1, ...
    let month_index = (y - 2025) * 12 + (m as i64 - 6);
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