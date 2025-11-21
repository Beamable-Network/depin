use depin_core::utils::{
    account::{read_account_data, reallocate_account_if_needed, write_account_data},
    bmb::{get_month_from_period, get_current_period, get_month_start_timestamp, SECONDS_PER_DAY},
};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};
use crate::{
    instruction::MonthlyPoolConfig,
    state::{worker_stake_config::WorkerStakeConfig, monthly_pool::MonthlyPool},
    types::WorkerStakeAccountType,
    utils::{MAX_BASIS_POINTS, validate_collection_authority},
};

const MAX_POOLS_PER_TX: usize = 12;
const TIME_LOCK_DAYS: i64 = 10;
const TIME_LOCK_SECONDS: i64 = TIME_LOCK_DAYS * SECONDS_PER_DAY;

pub fn process_set_monthly_pool<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    pools: Vec<MonthlyPoolConfig>,
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer, writable] Worker collection update authority (payer)
    // 1. [readonly] Worker collection account (Metaplex Core collection)
    // 2. [writable] WorkerStakeConfig PDA
    // 3. [readonly] System program
    // Remaining accounts: MonthlyPool PDAs (writable)

    if pools.len() > MAX_POOLS_PER_TX {
        msg!("Error: Maximum {} pools per transaction", MAX_POOLS_PER_TX);
        return Err(ProgramError::InvalidArgument);
    }

    let account_info_iter = &mut accounts.iter();
    let collection_authority_account = next_account_info(account_info_iter)?;
    let worker_collection_account = next_account_info(account_info_iter)?;
    let worker_stake_config_account = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    let rent = Rent::get()?;

    // Remaining accounts are monthly pool PDAs
    let monthly_pool_accounts: Vec<&AccountInfo> = account_info_iter.collect();

    if monthly_pool_accounts.len() != pools.len() {
        msg!("Error: Number of pool accounts must match number of pool configs");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate worker collection and authority
    validate_collection_authority(worker_collection_account, collection_authority_account)?;

    // Validate WorkerStakeConfig PDA
    let (config_pda, _bump) = WorkerStakeConfig::find_pda(program_id, worker_collection_account.key);
    if *worker_stake_config_account.key != config_pda {
        msg!("Error: WorkerStakeConfig account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Get current month for validation and compacting
    let current_period = get_current_period();
    let current_month_period = get_month_from_period(current_period);
    let current_timestamp = Clock::get()?.unix_timestamp;

    // Load and validate WorkerStakeConfig
    let data = worker_stake_config_account.try_borrow_data()?;
    let mut config: WorkerStakeConfig = read_account_data(&data, WorkerStakeAccountType::WorkerStakeConfig)?;
    drop(data);

    // Compact active_pools: remove past months
    config.active_pools.retain(|&m| m >= current_month_period);

    // Validate all pool configs
    for pool_config in &pools {
        // Validate month_period >= current_month_period
        if pool_config.month_period < current_month_period {
            msg!("Error: Cannot create/update pool for past month {}", pool_config.month_period);
            return Err(ProgramError::InvalidArgument);
        }

        // Validate base_revenue_percentage <= MAX_BASIS_POINTS
        if pool_config.base_revenue_percentage > MAX_BASIS_POINTS {
            msg!("Error: base_revenue_percentage cannot exceed {}", MAX_BASIS_POINTS);
            return Err(ProgramError::InvalidArgument);
        }

        // Validate addon_revenue_percentage <= MAX_BASIS_POINTS
        if pool_config.addon_revenue_percentage > MAX_BASIS_POINTS {
            msg!("Error: addon_revenue_percentage cannot exceed {}", MAX_BASIS_POINTS);
            return Err(ProgramError::InvalidArgument);
        }

        // Validate total revenue percentage <= MAX_BASIS_POINTS
        let total_revenue_percentage = pool_config.base_revenue_percentage
            .checked_add(pool_config.addon_revenue_percentage)
            .ok_or(ProgramError::InvalidArgument)?;

        if total_revenue_percentage > MAX_BASIS_POINTS {
            msg!("Error: Total revenue percentage ({}) cannot exceed {}", total_revenue_percentage, MAX_BASIS_POINTS);
            return Err(ProgramError::InvalidArgument);
        }

        // Validate base_emission_percentage <= MAX_BASIS_POINTS
        if pool_config.base_emission_percentage > MAX_BASIS_POINTS {
            msg!("Error: base_emission_percentage cannot exceed {}", MAX_BASIS_POINTS);
            return Err(ProgramError::InvalidArgument);
        }
    }

    // Process each pool
    for (i, pool_config) in pools.iter().enumerate() {
        let monthly_pool_account = monthly_pool_accounts[i];

        // Validate MonthlyPool PDA
        let (pool_pda, pool_bump) = MonthlyPool::find_pda(program_id, worker_collection_account.key, pool_config.month_period);
        if *monthly_pool_account.key != pool_pda {
            msg!("Error: MonthlyPool account does not match expected PDA for month {}", pool_config.month_period);
            return Err(ProgramError::InvalidArgument);
        }

        let pool_exists = !monthly_pool_account.data_is_empty();

        if pool_exists {
            // Pool exists - validate and update percentages
            let pool_data = monthly_pool_account.try_borrow_data()?;
            let pool: MonthlyPool = read_account_data(&pool_data, WorkerStakeAccountType::MonthlyPool)?;
            drop(pool_data);

            // Validate pool can be updated
            if pool.initialized {
                msg!("Error: Cannot update pool for month {} - already initialized (has stakers)", pool_config.month_period);
                return Err(ProgramError::InvalidArgument);
            }

            // Time-based lock: must be at least 10 days before month starts
            let month_start = get_month_start_timestamp(pool_config.month_period);
            let time_lock_threshold = month_start - TIME_LOCK_SECONDS;

            if current_timestamp >= time_lock_threshold {
                msg!(
                    "Error: Cannot update pool for month {} - within 10-day lock period (current: {}, threshold: {})",
                    pool_config.month_period,
                    current_timestamp,
                    time_lock_threshold
                );
                return Err(ProgramError::InvalidArgument);
            }

            // Update pool
            let mut pool_data = monthly_pool_account.try_borrow_mut_data()?;
            let mut pool: MonthlyPool = read_account_data(&pool_data, WorkerStakeAccountType::MonthlyPool)?;

            pool.base_revenue_percentage = pool_config.base_revenue_percentage;
            pool.addon_revenue_percentage = pool_config.addon_revenue_percentage;
            pool.base_emission_percentage = pool_config.base_emission_percentage;

            write_account_data(&mut pool_data, WorkerStakeAccountType::MonthlyPool, &pool)?;
            msg!("Updated pool for month {}", pool_config.month_period);
        } else {
            // Create new pool
            let space = MonthlyPool::SIZE;
            let rent_lamports = rent.minimum_balance(space);

            msg!("Creating MonthlyPool for month {}", pool_config.month_period);
            invoke_signed(
                &system_instruction::create_account(
                    collection_authority_account.key,
                    &pool_pda,
                    rent_lamports,
                    space as u64,
                    program_id,
                ),
                &[
                    collection_authority_account.clone(),
                    monthly_pool_account.clone(),
                    system_program.clone(),
                ],
                &[&[
                    MonthlyPool::SEED,
                    worker_collection_account.key.as_ref(),
                    &pool_config.month_period.to_le_bytes(),
                    &[pool_bump],
                ]],
            )?;

            // Initialize MonthlyPool data
            let pool = MonthlyPool::new(
                *worker_collection_account.key,
                pool_config.month_period,
                pool_config.base_revenue_percentage,
                pool_config.addon_revenue_percentage,
                pool_config.base_emission_percentage,
            );

            let mut pool_data = monthly_pool_account.try_borrow_mut_data()?;
            write_account_data(&mut pool_data, WorkerStakeAccountType::MonthlyPool, &pool)?;

            // Add to active_pools if not already present
            if !config.active_pools.contains(&pool_config.month_period) {
                if config.active_pools.len() >= WorkerStakeConfig::MAX_POOLS {
                    msg!("Error: Maximum {} pools can be tracked", WorkerStakeConfig::MAX_POOLS);
                    return Err(ProgramError::InvalidArgument);
                }
                config.active_pools.push(pool_config.month_period);
            }

            msg!("Created pool for month {}", pool_config.month_period);
        }
    }

    // Sort active_pools for efficient lookups
    config.active_pools.sort_unstable();

    let required_size = WorkerStakeConfig::required_size(config.active_pools.len());
    reallocate_account_if_needed(
        collection_authority_account,
        worker_stake_config_account,
        system_program,
        &rent,
        required_size,
    )?;

    // Save updated config
    let mut data = worker_stake_config_account.try_borrow_mut_data()?;
    write_account_data(&mut data, WorkerStakeAccountType::WorkerStakeConfig, &config)?;

    msg!("Successfully processed {} pool(s)", pools.len());
    Ok(())
}
