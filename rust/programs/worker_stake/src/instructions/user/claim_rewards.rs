use depin_core::{
    constants::{BMB_MINT, USDC_MINT},
    utils::{
        account::{read_account_data, write_account_data},
        bmb::{get_month_end_timestamp, get_month_start_timestamp, days_between, days_in_month, get_current_period, get_month_from_period},
    },
};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use crate::{
    state::{WorkerStakeConfig, MonthlyPool, UserStakePosition},
    types::WorkerStakeAccountType,
    utils::{
        find_usdc_treasury_pda,
        find_bmb_treasury_pda,
        calculate_time_weighted,
        validate_pda_account,
        validate_mint,
        require_signer,
        calculate_points,
        transfer_from_treasury,
        USDC_TREASURY_SEED,
        BMB_TREASURY_SEED,
    },
};

const USER_POSITION_SEED: &[u8] = b"user_position";
const USDC_DECIMALS: u8 = 6;

pub fn process_claim_rewards<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    month_period: u16,
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer, writable] User (payer for ATA creation)
    // 1. [readonly] Worker collection account
    // 2. [readonly] WorkerStakeConfig PDA
    // 3. [readonly] MonthlyPool for claimed month
    // 4. [writable] UserStakePosition PDA
    // 5. [readonly] USDC treasury PDA
    // 6. [writable] USDC treasury ATA (source)
    // 7. [writable] User USDC token account (destination)
    // 8. [readonly] BMB treasury PDA
    // 9. [writable] BMB treasury ATA (source)
    // 10. [writable] User BMB token account (destination)
    // 11. [readonly] USDC mint
    // 12. [readonly] BMB mint
    // 13. [readonly] Token program
    // 14. [readonly] Associated token program
    // 15. [readonly] System program

    let account_info_iter = &mut accounts.iter();
    let user_account = next_account_info(account_info_iter)?;
    let worker_collection_account = next_account_info(account_info_iter)?;
    let worker_stake_config_account = next_account_info(account_info_iter)?;
    let monthly_pool_account = next_account_info(account_info_iter)?;
    let user_position_account = next_account_info(account_info_iter)?;
    let usdc_treasury_pda = next_account_info(account_info_iter)?;
    let usdc_treasury_ata = next_account_info(account_info_iter)?;
    let user_usdc_account = next_account_info(account_info_iter)?;
    let bmb_treasury_pda = next_account_info(account_info_iter)?;
    let bmb_treasury_ata = next_account_info(account_info_iter)?;
    let user_bmb_account = next_account_info(account_info_iter)?;
    let usdc_mint_account = next_account_info(account_info_iter)?;
    let bmb_mint_account = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;
    let associated_token_program = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    // Validate user signature
    require_signer(user_account, "User")?;

    // Validate mints
    validate_mint(usdc_mint_account, &USDC_MINT, "USDC")?;
    validate_mint(bmb_mint_account, &BMB_MINT, "BMB")?;

    // Validate WorkerStakeConfig PDA
    let (config_pda, _bump) = WorkerStakeConfig::find_pda(program_id, worker_collection_account.key);
    validate_pda_account(worker_stake_config_account, &config_pda, "WorkerStakeConfig")?;

    // Load config
    let config_data = worker_stake_config_account.try_borrow_data()?;
    let config: WorkerStakeConfig = read_account_data(&config_data, WorkerStakeAccountType::WorkerStakeConfig)?;
    drop(config_data);

    // Validate UserStakePosition PDA
    let (user_position_pda, _user_bump) = Pubkey::find_program_address(
        &[USER_POSITION_SEED, user_account.key.as_ref(), worker_collection_account.key.as_ref()],
        program_id,
    );
    validate_pda_account(user_position_account, &user_position_pda, "UserStakePosition")?;

    // Load user position
    let position_data = user_position_account.try_borrow_data()?;
    let mut user_position: UserStakePosition = read_account_data(&position_data, WorkerStakeAccountType::UserStakePosition)?;
    drop(position_data);

    // Validate sequential claiming
    if user_position.last_claimed_month_period > 0 {
        if month_period != user_position.last_claimed_month_period + 1 {
            msg!(
                "Error: Must claim months in order (last_claimed: {}, attempting: {})",
                user_position.last_claimed_month_period,
                month_period
            );
            return Err(ProgramError::InvalidArgument);
        }
    }

    // Validate not claiming current or future months
    let current_month_period = get_month_from_period(get_current_period());
    if month_period >= current_month_period {
        msg!(
            "Error: Cannot claim current or future months (current: {}, attempting: {}). Wait until month ends.",
            current_month_period,
            month_period
        );
        return Err(ProgramError::InvalidArgument);
    }

    // Validate not opted out before this month
    if user_position.opted_out_at_month_period > 0 && month_period >= user_position.opted_out_at_month_period {
        msg!("Error: Cannot claim - opted out before this month");
        return Err(ProgramError::InvalidArgument);
    }

    // Check if pool exists - if not, skip with 0 rewards
    if !config.created_pools.contains(&month_period) {
        user_position.last_claimed_month_period = month_period;
        let mut position_data = user_position_account.try_borrow_mut_data()?;
        write_account_data(&mut position_data, WorkerStakeAccountType::UserStakePosition, &user_position)?;

        msg!("No pool exists for month {}, skipping with 0 rewards", month_period);
        return Ok(());
    }

    // Pool exists - validate and load it
    let (pool_pda, _pool_bump) = MonthlyPool::find_pda(program_id, worker_collection_account.key, month_period);
    validate_pda_account(monthly_pool_account, &pool_pda, "MonthlyPool")?;

    let pool_data = monthly_pool_account.try_borrow_data()?;
    let monthly_pool: MonthlyPool = read_account_data(&pool_data, WorkerStakeAccountType::MonthlyPool)?;
    drop(pool_data);

    if !monthly_pool.initialized {
        msg!("Error: MonthlyPool for month {} is not initialized", month_period);
        return Err(ProgramError::UninitializedAccount);
    }

    // Calculate user's stake-days for base pool
    let mut total_stake_days: u64 = 0;
    let month_end = get_month_end_timestamp(month_period);
    let days_in_month_val = days_in_month(month_period) as u64;

    for entry in user_position.stake_entries.iter() {
        if entry.month_period < month_period {
            // Full month weight for stakes before target month
            let stake_days = calculate_time_weighted(entry.amount, days_in_month_val)?;
            total_stake_days = total_stake_days
                .checked_add(stake_days)
                .ok_or(ProgramError::ArithmeticOverflow)?;
        } else if entry.month_period == month_period {
            // Partial weight based on time in month
            let days_remaining_i64 = days_between(entry.timestamp, month_end);
            let days_remaining = days_remaining_i64.max(0) as u64;

            let stake_days = calculate_time_weighted(entry.amount, days_remaining)?;
            total_stake_days = total_stake_days
                .checked_add(stake_days)
                .ok_or(ProgramError::ArithmeticOverflow)?;
        }
        // Skip if entry.month_period > month_period
    }

    // Calculate user's point-days for addon pool
    let mut total_point_days: u64 = 0;
    let mut cumulative_stake: u64 = 0;
    let mut last_checker_count: u16 = 0;
    let mut last_timestamp: i64 = get_month_start_timestamp(month_period);

    // Process all stake entries to calculate point-days
    for entry in user_position.stake_entries.iter() {
        if entry.month_period < month_period {
            // Entry before target month - accumulate stake and update checker_count
            cumulative_stake = cumulative_stake
                .checked_add(entry.amount)
                .ok_or(ProgramError::ArithmeticOverflow)?;
            last_checker_count = entry.checker_count;
        } else if entry.month_period == month_period {
            // Entry during target month
            // First, add point-days for the period BEFORE this entry
            let points_before = calculate_points(last_checker_count, cumulative_stake);
            let days_before_i64 = days_between(last_timestamp, entry.timestamp);
            let days_before = days_before_i64.max(0) as u64;

            total_point_days = total_point_days
                .checked_add(
                    points_before
                        .checked_mul(days_before)
                        .ok_or(ProgramError::ArithmeticOverflow)?
                )
                .ok_or(ProgramError::ArithmeticOverflow)?;

            // Update state with this entry
            cumulative_stake = cumulative_stake
                .checked_add(entry.amount)
                .ok_or(ProgramError::ArithmeticOverflow)?;
            last_checker_count = entry.checker_count;
            last_timestamp = entry.timestamp;
        } else {
            // Entry after target month - stop processing
            break;
        }
    }

    // Add point-days from last entry to end of month
    let points_final = calculate_points(last_checker_count, cumulative_stake);
    let days_remaining_i64 = days_between(last_timestamp, month_end);
    let days_remaining = days_remaining_i64.max(0) as u64;

    total_point_days = total_point_days
        .checked_add(
            points_final
                .checked_mul(days_remaining)
                .ok_or(ProgramError::ArithmeticOverflow)?
        )
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // Calculate rewards using proportional arithmetic
    // Base pool rewards (stake-days weighted)
    let usdc_base_reward = if monthly_pool.base_pool.total_weighted > 0 && total_stake_days > 0 {
        ((monthly_pool.base_pool.collected as u128)
            .checked_mul(total_stake_days as u128)
            .ok_or(ProgramError::ArithmeticOverflow)?
            .checked_div(monthly_pool.base_pool.total_weighted as u128)
            .ok_or(ProgramError::ArithmeticOverflow)?) as u64
    } else {
        0
    };

    let bmb_base_reward = if monthly_pool.base_pool.total_weighted > 0 && total_stake_days > 0 {
        ((monthly_pool.collected_bmb_base as u128)
            .checked_mul(total_stake_days as u128)
            .ok_or(ProgramError::ArithmeticOverflow)?
            .checked_div(monthly_pool.base_pool.total_weighted as u128)
            .ok_or(ProgramError::ArithmeticOverflow)?) as u64
    } else {
        0
    };

    // Addon pool rewards (points-based, WITH time-weighting) - USDC only
    let usdc_addon_reward = if monthly_pool.addon_pool.total_weighted > 0 && total_point_days > 0 {
        ((monthly_pool.addon_pool.collected as u128)
            .checked_mul(total_point_days as u128)
            .ok_or(ProgramError::ArithmeticOverflow)?
            .checked_div(monthly_pool.addon_pool.total_weighted as u128)
            .ok_or(ProgramError::ArithmeticOverflow)?) as u64
    } else {
        0
    };

    // Total rewards
    let total_usdc = usdc_base_reward
        .checked_add(usdc_addon_reward)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let total_bmb = bmb_base_reward;

    // Transfer USDC if > 0
    if total_usdc > 0 {
        transfer_from_treasury(
            usdc_treasury_pda,
            usdc_treasury_ata,
            user_account,
            user_usdc_account,
            usdc_mint_account,
            token_program,
            associated_token_program,
            system_program,
            program_id,
            worker_collection_account.key,
            USDC_TREASURY_SEED,
            find_usdc_treasury_pda,
            total_usdc,
            USDC_DECIMALS,
            "USDC",
        )?;
    }

    // Transfer BMB if > 0
    if total_bmb > 0 {
        transfer_from_treasury(
            bmb_treasury_pda,
            bmb_treasury_ata,
            user_account,
            user_bmb_account,
            bmb_mint_account,
            token_program,
            associated_token_program,
            system_program,
            program_id,
            worker_collection_account.key,
            BMB_TREASURY_SEED,
            find_bmb_treasury_pda,
            total_bmb,
            depin_core::constants::BMB_DECIMALS,
            "BMB",
        )?;
    }

    // Update last_claimed_month_period
    user_position.last_claimed_month_period = month_period;

    // Save updated user position
    let mut position_data = user_position_account.try_borrow_mut_data()?;
    write_account_data(&mut position_data, WorkerStakeAccountType::UserStakePosition, &user_position)?;

    msg!(
        "Claimed rewards for month {}: {} USDC (base: {}, addon: {}), {} BMB",
        month_period,
        total_usdc,
        usdc_base_reward,
        usdc_addon_reward,
        total_bmb
    );
    Ok(())
}
