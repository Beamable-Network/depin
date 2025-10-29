use depin_core::utils::{
    account::{read_account_data, write_account_data},
    bmb::{get_current_period, get_month_from_period},
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
    utils::BMB_PER_POINT,
};

const USER_POSITION_SEED: &[u8] = b"user_position";

pub fn process_unstake<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] User
    // 1. [readonly] Worker collection account
    // 2. [readonly] WorkerStakeConfig PDA
    // 3. [writable] UserStakePosition PDA
    // Remaining accounts: [writable] Last active MonthlyPool (if needed)

    let account_info_iter = &mut accounts.iter();
    let user_account = next_account_info(account_info_iter)?;
    let worker_collection_account = next_account_info(account_info_iter)?;
    let worker_stake_config_account = next_account_info(account_info_iter)?;
    let user_position_account = next_account_info(account_info_iter)?;

    // Remaining accounts
    let remaining_accounts: Vec<&AccountInfo> = account_info_iter.collect();

    // Validate user signature
    if !user_account.is_signer {
        msg!("Error: User must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Get current month
    let current_period = get_current_period();
    let current_month_period = get_month_from_period(current_period);

    // Validate WorkerStakeConfig PDA
    let (config_pda, _bump) = WorkerStakeConfig::find_pda(program_id, worker_collection_account.key);
    if *worker_stake_config_account.key != config_pda {
        msg!("Error: WorkerStakeConfig account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Load config
    let config_data = worker_stake_config_account.try_borrow_data()?;
    let config: WorkerStakeConfig = read_account_data(&config_data, WorkerStakeAccountType::WorkerStakeConfig)?;
    drop(config_data);

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

    // Check if has active pool
    let has_active_pool = config.created_pools.contains(&current_month_period);

    if has_active_pool {
        // Must have a last active pool if there's an active pool
        if config.last_active_pool_month == 0 {
            msg!("Error: No last active pool found");
            return Err(ProgramError::InvalidAccountData);
        }

        // Get last active pool account from remaining accounts
        let last_active_pool_account = remaining_accounts.get(0).ok_or_else(|| {
            msg!("Error: Last active pool account required");
            ProgramError::NotEnoughAccountKeys
        })?;

        // Validate last active pool PDA
        let (expected_pool_pda, _pool_bump) = MonthlyPool::find_pda(
            program_id,
            worker_collection_account.key,
            config.last_active_pool_month,
        );
        if *last_active_pool_account.key != expected_pool_pda {
            msg!("Error: Last active pool account does not match expected PDA");
            return Err(ProgramError::InvalidArgument);
        }

        // Load last active pool
        let pool_data = last_active_pool_account.try_borrow_data()?;
        let mut last_active_pool: MonthlyPool = read_account_data(&pool_data, WorkerStakeAccountType::MonthlyPool)?;
        drop(pool_data);

        // Mark stake as opted-out in the last active pool
        last_active_pool.base_pool.total_opted_out = last_active_pool.base_pool.total_opted_out
            .checked_add(user_position.staked_amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        // Calculate user's current points and mark as opted-out for addon pool
        // Use the most recent checker_count (from last stake entry)
        if let Some(last_entry) = user_position.stake_entries.last() {
            let checker_count = last_entry.checker_count as u64;
            let max_points_from_stake = user_position.staked_amount / BMB_PER_POINT;
            let user_points = std::cmp::min(checker_count, max_points_from_stake);

            last_active_pool.addon_pool.total_opted_out = last_active_pool.addon_pool.total_opted_out
                .checked_add(user_points)
                .ok_or(ProgramError::ArithmeticOverflow)?;
        }

        // User can withdraw after current month ends
        user_position.opted_out_at_month_period = current_month_period + 1;

        // Save updated pool
        let mut pool_data = last_active_pool_account.try_borrow_mut_data()?;
        write_account_data(&mut pool_data, WorkerStakeAccountType::MonthlyPool, &last_active_pool)?;

        msg!(
            "User opted out. Can withdraw after month {} ends",
            current_month_period
        );
    } else {
        // No active pool - user can withdraw immediately
        user_position.opted_out_at_month_period = current_month_period;
        msg!("No active pool. User can withdraw immediately");
    }

    // Save updated user position
    let mut position_data = user_position_account.try_borrow_mut_data()?;
    write_account_data(&mut position_data, WorkerStakeAccountType::UserStakePosition, &user_position)?;

    msg!("User unstaked successfully");
    Ok(())
}
