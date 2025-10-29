use depin_core::{
    constants::{BMB_MINT, BMB_DECIMALS, USDC_MINT},
    utils::{
        account::{read_account_data, write_account_data},
        bmb::{get_month_end_timestamp, get_month_start_timestamp, days_between, days_in_month},
    },
};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use spl_token::instruction::transfer_checked;
use crate::{
    state::{WorkerStakeConfig, MonthlyPool, UserStakePosition},
    types::WorkerStakeAccountType,
    utils::{
        find_usdc_treasury_pda,
        find_bmb_treasury_pda,
        USDC_TREASURY_SEED,
        BMB_TREASURY_SEED,
        BMB_PER_POINT,
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
    // 0. [signer] User
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

    // Validate user signature
    if !user_account.is_signer {
        msg!("Error: User must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate mints
    if *usdc_mint_account.key != USDC_MINT {
        msg!("Error: Invalid USDC mint");
        return Err(ProgramError::InvalidArgument);
    }
    if *bmb_mint_account.key != BMB_MINT {
        msg!("Error: Invalid BMB mint");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate WorkerStakeConfig PDA
    let (config_pda, _bump) = WorkerStakeConfig::find_pda(program_id, worker_collection_account.key);
    if *worker_stake_config_account.key != config_pda {
        msg!("Error: WorkerStakeConfig account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Load config
    let config_data = worker_stake_config_account.try_borrow_data()?;
    let _config: WorkerStakeConfig = read_account_data(&config_data, WorkerStakeAccountType::WorkerStakeConfig)?;
    drop(config_data);

    // Validate MonthlyPool PDA
    let (pool_pda, _pool_bump) = MonthlyPool::find_pda(program_id, worker_collection_account.key, month_period);
    if *monthly_pool_account.key != pool_pda {
        msg!("Error: MonthlyPool account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Load monthly pool
    let pool_data = monthly_pool_account.try_borrow_data()?;
    let monthly_pool: MonthlyPool = read_account_data(&pool_data, WorkerStakeAccountType::MonthlyPool)?;
    drop(pool_data);

    // Validate UserStakePosition PDA
    let (user_position_pda, _user_bump) = Pubkey::find_program_address(
        &[USER_POSITION_SEED, user_account.key.as_ref(), worker_collection_account.key.as_ref()],
        program_id,
    );
    if *user_position_account.key != user_position_pda {
        msg!("Error: UserStakePosition account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

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

    // Validate not opted out before this month
    if user_position.opted_out_at_month_period > 0 && month_period >= user_position.opted_out_at_month_period {
        msg!("Error: Cannot claim - opted out before this month");
        return Err(ProgramError::InvalidArgument);
    }

    // Calculate user's time-weighted stake for base pool (BMB-weighted)
    let mut total_bmb_weight: u64 = 0;
    let month_end = get_month_end_timestamp(month_period);
    let days_in_month_val = days_in_month(month_period) as u64;

    for entry in user_position.stake_entries.iter() {
        if entry.month_period < month_period {
            // Full weight for stakes before target month
            total_bmb_weight = total_bmb_weight
                .checked_add(entry.amount)
                .ok_or(ProgramError::ArithmeticOverflow)?;
        } else if entry.month_period == month_period {
            // Partial weight based on time in month
            let days_remaining_i64 = days_between(entry.timestamp, month_end);
            let days_remaining = days_remaining_i64.max(0) as u64;

            let weighted = ((entry.amount as u128)
                .checked_mul(days_remaining as u128)
                .ok_or(ProgramError::ArithmeticOverflow)?
                .checked_div(days_in_month_val as u128)
                .ok_or(ProgramError::ArithmeticOverflow)?) as u64;

            total_bmb_weight = total_bmb_weight
                .checked_add(weighted)
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
            let points_before = std::cmp::min(last_checker_count as u64, cumulative_stake / BMB_PER_POINT);
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
    let points_final = std::cmp::min(last_checker_count as u64, cumulative_stake / BMB_PER_POINT);
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
    // Base pool rewards (BMB-weighted, time-weighted)
    let usdc_base_reward = if monthly_pool.base_pool.total_weighted > 0 && total_bmb_weight > 0 {
        ((monthly_pool.base_pool.collected as u128)
            .checked_mul(total_bmb_weight as u128)
            .ok_or(ProgramError::ArithmeticOverflow)?
            .checked_div(monthly_pool.base_pool.total_weighted as u128)
            .ok_or(ProgramError::ArithmeticOverflow)?) as u64
    } else {
        0
    };

    let bmb_base_reward = if monthly_pool.base_pool.total_weighted > 0 && total_bmb_weight > 0 {
        ((monthly_pool.collected_bmb_base as u128)
            .checked_mul(total_bmb_weight as u128)
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
        // Validate USDC treasury PDA
        let (expected_usdc_pda, usdc_bump) = find_usdc_treasury_pda(program_id, worker_collection_account.key);
        if *usdc_treasury_pda.key != expected_usdc_pda {
            msg!("Error: USDC treasury PDA does not match expected address");
            return Err(ProgramError::InvalidArgument);
        }

        // Validate USDC treasury ATA
        let expected_usdc_ata = spl_associated_token_account::get_associated_token_address(
            usdc_treasury_pda.key,
            usdc_mint_account.key,
        );
        if *usdc_treasury_ata.key != expected_usdc_ata {
            msg!("Error: USDC treasury ATA does not match expected address");
            return Err(ProgramError::InvalidArgument);
        }

        // Transfer USDC
        let transfer_ix = transfer_checked(
            token_program.key,
            usdc_treasury_ata.key,
            usdc_mint_account.key,
            user_usdc_account.key,
            usdc_treasury_pda.key,
            &[],
            total_usdc,
            USDC_DECIMALS,
        )?;

        let signer_seeds = &[
            USDC_TREASURY_SEED,
            worker_collection_account.key.as_ref(),
            &[usdc_bump],
        ];

        invoke_signed(
            &transfer_ix,
            &[
                usdc_treasury_ata.clone(),
                usdc_mint_account.clone(),
                user_usdc_account.clone(),
                usdc_treasury_pda.clone(),
                token_program.clone(),
            ],
            &[signer_seeds],
        )?;
    }

    // Transfer BMB if > 0
    if total_bmb > 0 {
        // Validate BMB treasury PDA
        let (expected_bmb_pda, bmb_bump) = find_bmb_treasury_pda(program_id, worker_collection_account.key);
        if *bmb_treasury_pda.key != expected_bmb_pda {
            msg!("Error: BMB treasury PDA does not match expected address");
            return Err(ProgramError::InvalidArgument);
        }

        // Validate BMB treasury ATA
        let expected_bmb_ata = spl_associated_token_account::get_associated_token_address(
            bmb_treasury_pda.key,
            bmb_mint_account.key,
        );
        if *bmb_treasury_ata.key != expected_bmb_ata {
            msg!("Error: BMB treasury ATA does not match expected address");
            return Err(ProgramError::InvalidArgument);
        }

        // Transfer BMB
        let transfer_ix = transfer_checked(
            token_program.key,
            bmb_treasury_ata.key,
            bmb_mint_account.key,
            user_bmb_account.key,
            bmb_treasury_pda.key,
            &[],
            total_bmb,
            BMB_DECIMALS,
        )?;

        let signer_seeds = &[
            BMB_TREASURY_SEED,
            worker_collection_account.key.as_ref(),
            &[bmb_bump],
        ];

        invoke_signed(
            &transfer_ix,
            &[
                bmb_treasury_ata.clone(),
                bmb_mint_account.clone(),
                user_bmb_account.clone(),
                bmb_treasury_pda.clone(),
                token_program.clone(),
            ],
            &[signer_seeds],
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
