use depin_core::{
    constants::{BMB_MINT, BMB_DECIMALS},
    utils::{
        account::{read_account_data, reallocate_account_if_needed, write_account_data},
        bmb::{get_current_period, get_month_from_period, get_month_end_timestamp, days_between, days_in_month, validate_worker_tree},
        tokens::initialize_ata_if_needed,
        bgum::verify_license_and_owner,
    },
};
use mpl_bubblegum::types::LeafSchema;
use mpl_bubblegum::utils::get_asset_id;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    msg,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};
use spl_token::instruction::transfer_checked;
use crate::{
    instruction::StakeParams,
    state::{WorkerStakeConfig, MonthlyPool, UserStakePosition, StakeEntry},
    types::WorkerStakeAccountType,
    utils::{
        find_community_stake_vault_pda,
        initialize_pool_with_inheritance,
        BMB_PER_POINT,
    },
};
use borsh::BorshDeserialize;

const USER_POSITION_SEED: &[u8] = b"user_position";

pub fn process_stake<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    instruction_data: &[u8],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer, writable] User (payer for account creation/realloc)
    // 1. [signer] Worker (co-signing to vouch for checker_count)
    // 2. [readonly] Worker collection account
    // 3. [writable] WorkerStakeConfig PDA
    // 4. [writable] MonthlyPool for current month
    // 5. [writable] UserStakePosition PDA (may need creation/realloc)
    // 6. [writable] User token account (source BMB)
    // 7. [readonly] Community stake vault PDA
    // 8. [writable] Community stake vault ATA (destination BMB)
    // 9. [readonly] BMB mint
    // 10. [readonly] Token program
    // 11. [readonly] Associated token program
    // 12. [readonly] System program
    // 13. [readonly] mpl_account_compression program
    // 14. [readonly] Merkle tree account (worker license tree)
    // 15. [writable] Previous MonthlyPool (if not needed, pass system program)
    // Remaining accounts: [readonly] Proof accounts for Merkle tree verification

    let account_info_iter = &mut accounts.iter();
    let user_account = next_account_info(account_info_iter)?;
    let worker_account = next_account_info(account_info_iter)?;
    let worker_collection_account = next_account_info(account_info_iter)?;
    let worker_stake_config_account = next_account_info(account_info_iter)?;
    let monthly_pool_account = next_account_info(account_info_iter)?;
    let user_position_account = next_account_info(account_info_iter)?;
    let user_token_account = next_account_info(account_info_iter)?;
    let community_vault_pda = next_account_info(account_info_iter)?;
    let community_vault_ata = next_account_info(account_info_iter)?;
    let bmb_mint_account = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;
    let associated_token_program = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;
    let _mpl_account_compression_program = next_account_info(account_info_iter)?;
    let merkle_tree_account = next_account_info(account_info_iter)?;
    let prev_pool_account = next_account_info(account_info_iter)?;

    let rent = Rent::get()?;

    // Remaining accounts (proof accounts for Merkle tree verification)
    let proof_accounts: Vec<AccountInfo> = account_info_iter.cloned().collect();

    // Parse instruction data
    let params = StakeParams::try_from_slice(instruction_data)?;
    let amount = params.amount;
    let checker_count = params.checker_count;
    let license = params.license_context;

    // Validate amount > 0
    if amount == 0 {
        msg!("Error: Amount must be greater than 0");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate user signature
    if !user_account.is_signer {
        msg!("Error: User must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // --- WORKER LICENSE VERIFICATION ---

    // Calculate the leaf asset ID (worker license)
    let leaf_asset_id = get_asset_id(merkle_tree_account.key, license.nonce);

    let license_leaf = LeafSchema::V2 {
        id: leaf_asset_id,
        owner: license.owner,
        delegate: license.delegate,
        nonce: license.nonce,
        data_hash: license.data_hash,
        creator_hash: license.creator_hash,
        collection_hash: license.get_collection_hash(),
        asset_data_hash: license.asset_data_hash,
        flags: license.flags,
    };

    let license_leaf_hash = license_leaf.hash();

    // Validate Merkle tree
    validate_worker_tree(merkle_tree_account.key)?;

    // Verify worker license ownership
    verify_license_and_owner(
        merkle_tree_account,
        &proof_accounts,
        &license,
        license_leaf_hash,
        worker_account,
    )?;

    // Verify license collection matches worker_collection
    if let Some(collection) = license.collection {
        if &collection != worker_collection_account.key {
            msg!("Error: Worker license collection does not match worker_collection");
            return Err(ProgramError::InvalidArgument);
        }
    } else {
        msg!("Error: Worker license must have a collection");
        return Err(ProgramError::InvalidArgument);
    }

    msg!("Worker license verified for worker: {}", worker_account.key);

    // Validate BMB mint
    if *bmb_mint_account.key != BMB_MINT {
        msg!("Error: Invalid BMB mint");
        return Err(ProgramError::InvalidArgument);
    }

    // Get current month
    let current_period = get_current_period();
    let current_month_period = get_month_from_period(current_period);
    let current_timestamp = Clock::get()?.unix_timestamp;

    // Validate WorkerStakeConfig PDA
    let (config_pda, _bump) = WorkerStakeConfig::find_pda(program_id, worker_collection_account.key);
    if *worker_stake_config_account.key != config_pda {
        msg!("Error: WorkerStakeConfig account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Load config
    let config_data = worker_stake_config_account.try_borrow_data()?;
    let mut config: WorkerStakeConfig = read_account_data(&config_data, WorkerStakeAccountType::WorkerStakeConfig)?;
    drop(config_data);

    // Validate pool exists for current month
    if !config.created_pools.contains(&current_month_period) {
        msg!("Error: No pool exists for current month {}", current_month_period);
        return Err(ProgramError::InvalidArgument);
    }

    // Validate MonthlyPool PDA
    let (pool_pda, _pool_bump) = MonthlyPool::find_pda(program_id, worker_collection_account.key, current_month_period);
    if *monthly_pool_account.key != pool_pda {
        msg!("Error: MonthlyPool account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Load monthly pool
    let pool_data = monthly_pool_account.try_borrow_data()?;
    let mut monthly_pool: MonthlyPool = read_account_data(&pool_data, WorkerStakeAccountType::MonthlyPool)?;
    drop(pool_data);

    // Initialize pool if needed (with inheritance)
    // If last_active_pool_month > 0, use prev_pool_account (account #15)
    // Otherwise, pass None
    let prev_pool_option = if config.last_active_pool_month > 0 {
        // Check if prev_pool_account is the system program (indicates no previous pool needed)
        if prev_pool_account.key == system_program.key {
            None
        } else {
            Some(prev_pool_account)
        }
    } else {
        None
    };

    initialize_pool_with_inheritance(
        program_id,
        worker_collection_account.key,
        current_month_period,
        &mut monthly_pool,
        &mut config,
        prev_pool_option,
    )?;

    // Validate UserStakePosition PDA
    let (user_position_pda, _user_position_bump) = Pubkey::find_program_address(
        &[USER_POSITION_SEED, user_account.key.as_ref(), worker_collection_account.key.as_ref()],
        program_id,
    );
    if *user_position_account.key != user_position_pda {
        msg!("Error: UserStakePosition account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Load or create UserStakePosition
    let position_exists = !user_position_account.data_is_empty();
    let mut user_position: UserStakePosition;

    if position_exists {
        let position_data = user_position_account.try_borrow_data()?;
        user_position = read_account_data(&position_data, WorkerStakeAccountType::UserStakePosition)?;
        drop(position_data);
    } else {
        user_position = UserStakePosition {
            user: *user_account.key,
            worker_collection: *worker_collection_account.key,
            staked_amount: 0,
            stake_entries: Vec::new(),
            opted_out_at_month_period: 0,
            last_claimed_month_period: 0,
        };

        let space = UserStakePosition::required_size(0);
        let rent_lamports = rent.minimum_balance(space);

        msg!("Creating UserStakePosition PDA");
        invoke(
            &system_instruction::create_account(
                user_account.key,
                &user_position_pda,
                rent_lamports,
                space as u64,
                program_id,
            ),
            &[
                user_account.clone(),
                user_position_account.clone(),
                system_program.clone(),
            ],
        )?;
    }

    if user_position.stake_entries.len() >= UserStakePosition::MAX_ENTRIES {
        msg!("Error: Maximum stake entries reached ({})", UserStakePosition::MAX_ENTRIES);
        return Err(ProgramError::InvalidArgument);
    }

    // Calculate OLD points (before this stake)
    let old_checker_count = if user_position.stake_entries.is_empty() {
        0u64
    } else {
        user_position.stake_entries.last().unwrap().checker_count as u64
    };
    let old_stake = user_position.staked_amount;
    let old_points = std::cmp::min(old_checker_count, old_stake / BMB_PER_POINT);

    // Add new StakeEntry
    let new_entry = StakeEntry {
        amount,
        timestamp: current_timestamp,
        month_period: current_month_period,
        checker_count,
    };
    user_position.stake_entries.push(new_entry);

    // Update user's total stake
    user_position.staked_amount = user_position.staked_amount
        .checked_add(amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let required_size = UserStakePosition::required_size(user_position.stake_entries.len());
    reallocate_account_if_needed(
        user_account,
        user_position_account,
        system_program,
        &rent,
        required_size,
    )?;

    // Validate community vault PDA
    let (expected_vault_pda, _vault_bump) = find_community_stake_vault_pda(program_id, worker_collection_account.key);
    if *community_vault_pda.key != expected_vault_pda {
        msg!("Error: Community stake vault PDA does not match expected address");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate community vault ATA
    let expected_vault_ata = spl_associated_token_account::get_associated_token_address(
        community_vault_pda.key,
        bmb_mint_account.key,
    );
    if *community_vault_ata.key != expected_vault_ata {
        msg!("Error: Community stake vault ATA does not match expected address");
        return Err(ProgramError::InvalidArgument);
    }

    // Initialize community vault ATA if needed (lazy)
    initialize_ata_if_needed(
        user_account,
        community_vault_pda,
        bmb_mint_account,
        community_vault_ata,
        token_program,
        associated_token_program,
    )?;

    // Transfer BMB from user to community vault
    let transfer_ix = transfer_checked(
        token_program.key,
        user_token_account.key,
        bmb_mint_account.key,
        community_vault_ata.key,
        user_account.key,
        &[],
        amount,
        BMB_DECIMALS,
    )?;

    invoke(
        &transfer_ix,
        &[
            user_token_account.clone(),
            bmb_mint_account.clone(),
            community_vault_ata.clone(),
            user_account.clone(),
            token_program.clone(),
        ],
    )?;

    // Calculate NEW points (after this stake)
    let new_points = std::cmp::min(checker_count as u64, user_position.staked_amount / BMB_PER_POINT);

    // Calculate time-weighted values
    let month_end = get_month_end_timestamp(current_month_period);
    let days_remaining_i64 = days_between(current_timestamp, month_end);

    // Validation
    if days_remaining_i64 < 0 {
        msg!("Error: Cannot stake after month ends");
        return Err(ProgramError::InvalidArgument);
    }

    let days_remaining = days_remaining_i64 as u64;
    let days_in_month_val = days_in_month(current_month_period) as u64;

    if days_remaining > days_in_month_val {
        msg!("Error: Invalid timestamp");
        return Err(ProgramError::InvalidArgument);
    }

    // Update base pool: weighted by BMB amount (time-weighted)
    let weighted_amount = ((amount as u128)
        .checked_mul(days_remaining as u128)
        .ok_or(ProgramError::ArithmeticOverflow)?
        .checked_div(days_in_month_val as u128)
        .ok_or(ProgramError::ArithmeticOverflow)?) as u64;

    monthly_pool.base_pool.total = monthly_pool.base_pool.total
        .checked_add(amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    monthly_pool.base_pool.total_weighted = monthly_pool.base_pool.total_weighted
        .checked_add(weighted_amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // Update addon pool: weighted by points (time-weighted)
    let points_delta = new_points as i64 - old_points as i64;

    // Update total (can be positive or negative delta)
    if points_delta >= 0 {
        monthly_pool.addon_pool.total = monthly_pool.addon_pool.total
            .checked_add(points_delta as u64)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    } else {
        monthly_pool.addon_pool.total = monthly_pool.addon_pool.total
            .checked_sub((-points_delta) as u64)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    }

    // Update weighted total with time-weighting
    let weighted_points_delta = ((points_delta.abs() as u128)
        .checked_mul(days_remaining as u128)
        .ok_or(ProgramError::ArithmeticOverflow)?
        .checked_div(days_in_month_val as u128)
        .ok_or(ProgramError::ArithmeticOverflow)?) as u64;

    if points_delta >= 0 {
        monthly_pool.addon_pool.total_weighted = monthly_pool.addon_pool.total_weighted
            .checked_add(weighted_points_delta)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    } else {
        monthly_pool.addon_pool.total_weighted = monthly_pool.addon_pool.total_weighted
            .saturating_sub(weighted_points_delta);
    }

    // Update config.total_staked
    config.total_staked = config.total_staked
        .checked_add(amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // Save all updated accounts
    let mut position_data = user_position_account.try_borrow_mut_data()?;
    write_account_data(&mut position_data, WorkerStakeAccountType::UserStakePosition, &user_position)?;
    drop(position_data);

    let mut pool_data = monthly_pool_account.try_borrow_mut_data()?;
    write_account_data(&mut pool_data, WorkerStakeAccountType::MonthlyPool, &monthly_pool)?;
    drop(pool_data);

    let mut config_data = worker_stake_config_account.try_borrow_mut_data()?;
    write_account_data(&mut config_data, WorkerStakeAccountType::WorkerStakeConfig, &config)?;

    msg!(
        "User staked {} BMB with {} checkers. Points: {} -> {}. Total staked: {}",
        amount,
        checker_count,
        old_points,
        new_points,
        user_position.staked_amount
    );
    Ok(())
}
