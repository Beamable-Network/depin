use depin_core::{
    constants::{BMB_DECIMALS, BMB_MINT},
    utils::{
        account::{read_account_data, write_account_data},
        bmb::{get_current_period, get_month_from_period}, validation::{require_signer, validate_ata_account, validate_mint, validate_pda_account},
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
    state::{WorkerStakeConfig, UserStakePosition},
    types::WorkerStakeAccountType,
    utils::{
        find_community_stake_vault_pda,
        COMMUNITY_STAKE_VAULT_SEED,
    },
};

const USER_POSITION_SEED: &[u8] = b"user_position";

pub fn process_withdraw<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] User
    // 1. [writable] Worker account (rent recipient - must match WorkerStakeConfig.worker_wallet)
    // 2. [readonly] Worker collection account
    // 3. [writable] WorkerStakeConfig PDA
    // 4. [writable] UserStakePosition PDA
    // 5. [readonly] Community stake vault PDA
    // 6. [writable] Community stake vault ATA (source)
    // 7. [writable] User token account (destination)
    // 8. [readonly] BMB mint
    // 9. [readonly] Token program

    let account_info_iter = &mut accounts.iter();
    let user_account = next_account_info(account_info_iter)?;
    let worker_account = next_account_info(account_info_iter)?;
    let worker_collection_account = next_account_info(account_info_iter)?;
    let worker_stake_config_account = next_account_info(account_info_iter)?;
    let user_position_account = next_account_info(account_info_iter)?;
    let community_vault_pda = next_account_info(account_info_iter)?;
    let community_vault_ata = next_account_info(account_info_iter)?;
    let user_token_account = next_account_info(account_info_iter)?;
    let bmb_mint_account = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;

    // Validate user signature
    require_signer(user_account, "User")?;

    // Validate BMB mint
    validate_mint(bmb_mint_account, &BMB_MINT, "BMB")?;

    // Get current month
    let current_period = get_current_period();
    let current_month_period = get_month_from_period(current_period);

    // Validate WorkerStakeConfig PDA
    let (config_pda, _bump) = WorkerStakeConfig::find_pda(program_id, worker_collection_account.key);
    validate_pda_account(worker_stake_config_account, &config_pda, "WorkerStakeConfig")?;

    // Load config
    let config_data = worker_stake_config_account.try_borrow_data()?;
    let mut config: WorkerStakeConfig = read_account_data(&config_data, WorkerStakeAccountType::WorkerStakeConfig)?;
    drop(config_data);

    // Validate worker account matches config.worker_wallet
    if worker_account.key != &config.worker_wallet {
        msg!("Error: Worker account does not match config.worker_wallet");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate UserStakePosition PDA
    let (user_position_pda, _user_bump) = Pubkey::find_program_address(
        &[USER_POSITION_SEED, user_account.key.as_ref(), worker_collection_account.key.as_ref()],
        program_id,
    );
    validate_pda_account(user_position_account, &user_position_pda, "UserStakePosition")?;

    // Load user position
    let position_data = user_position_account.try_borrow_data()?;
    let user_position: UserStakePosition = read_account_data(&position_data, WorkerStakeAccountType::UserStakePosition)?;
    drop(position_data);

    // Validate requirements
    let has_active_pool = config.created_pools.contains(&current_month_period);

    // Check if user can withdraw (must have opted out and waited)
    // Always require unstake first to properly update last active pool's opted_out accounting
    if user_position.opted_out_at_month_period == 0 {
        msg!("Error: Must call unstake first before withdrawing");
        return Err(ProgramError::InvalidArgument);
    }

    // Only enforce waiting period if there's an active pool
    if has_active_pool && current_month_period < user_position.opted_out_at_month_period {
        msg!(
            "Error: Must wait until month {} to withdraw",
            user_position.opted_out_at_month_period
        );
        return Err(ProgramError::InvalidArgument);
    }

    // Check all rewards claimed (find last claimable month)
    let last_claimable_month = if user_position.opted_out_at_month_period > 0 {
        user_position.opted_out_at_month_period.saturating_sub(1)  // Can only claim up to month before opted out
    } else {
        current_month_period.saturating_sub(1)  // Can claim up to previous month (not current)
    };

    if last_claimable_month > 0 && user_position.last_claimed_month_period < last_claimable_month {
        msg!(
            "Error: Must claim all pending rewards first (last_claimed: {}, last_claimable: {})",
            user_position.last_claimed_month_period,
            last_claimable_month
        );
        return Err(ProgramError::InvalidArgument);
    }

    // Validate community vault PDA
    let (expected_vault_pda, vault_bump) = find_community_stake_vault_pda(program_id, worker_collection_account.key);
    validate_pda_account(community_vault_pda, &expected_vault_pda, "Community stake vault")?;

    // Validate community vault ATA
    validate_ata_account(community_vault_ata, community_vault_pda.key, bmb_mint_account.key, "Community stake vault")?;

    // Transfer BMB from community vault to user (PDA must sign)
    let transfer_ix = transfer_checked(
        token_program.key,
        community_vault_ata.key,
        bmb_mint_account.key,
        user_token_account.key,
        community_vault_pda.key,
        &[],
        user_position.staked_amount,
        BMB_DECIMALS,
    )?;

    let signer_seeds = &[
        COMMUNITY_STAKE_VAULT_SEED,
        worker_collection_account.key.as_ref(),
        &[vault_bump],
    ];

    invoke_signed(
        &transfer_ix,
        &[
            community_vault_ata.clone(),
            bmb_mint_account.clone(),
            user_token_account.clone(),
            community_vault_pda.clone(),
            token_program.clone(),
        ],
        &[signer_seeds],
    )?;

    // Update config.total_staked
    config.total_staked = config.total_staked
        .checked_sub(user_position.staked_amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // Save updated config
    let mut config_data = worker_stake_config_account.try_borrow_mut_data()?;
    write_account_data(&mut config_data, WorkerStakeAccountType::WorkerStakeConfig, &config)?;

    // Close UserStakePosition account (rent returned to worker)
    let dest_starting_lamports = worker_account.lamports();
    **worker_account.lamports.borrow_mut() = dest_starting_lamports
        .checked_add(user_position_account.lamports())
        .ok_or(ProgramError::ArithmeticOverflow)?;
    **user_position_account.lamports.borrow_mut() = 0;

    // Zero out the account data
    let mut position_data = user_position_account.try_borrow_mut_data()?;
    position_data.fill(0);

    msg!("User withdrew {} BMB. Position closed, rent returned to worker.", user_position.staked_amount);
    Ok(())
}
