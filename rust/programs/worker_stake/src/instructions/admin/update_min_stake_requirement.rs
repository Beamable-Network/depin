use depin_core::{constants::NETWORK_ADMIN, utils::account::{read_account_data, write_account_data}};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use crate::{
    state::worker_stake_config::WorkerStakeConfig,
    types::WorkerStakeAccountType,
    utils::{validate_collection_authority},
};

pub fn process_update_min_stake_requirement<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    new_min_stake_requirement: u64,
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Worker collection update authority
    // 1. [signer] Network admin
    // 2. [readonly] Worker collection account (Metaplex Core collection)
    // 3. [writable] WorkerStakeConfig PDA

    let account_info_iter = &mut accounts.iter();
    let collection_authority_account = next_account_info(account_info_iter)?;
    let network_admin_account = next_account_info(account_info_iter)?;
    let worker_collection_account = next_account_info(account_info_iter)?;
    let worker_stake_config_account = next_account_info(account_info_iter)?;

    // Validate network admin signature
    if !network_admin_account.is_signer {
        msg!("Error: Network admin must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate network admin pubkey
    if network_admin_account.key != &NETWORK_ADMIN {
        msg!("Error: Invalid network admin pubkey");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate new_min_stake_requirement > 0
    if new_min_stake_requirement == 0 {
        msg!("Error: new_min_stake_requirement must be greater than 0");
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

    // Load WorkerStakeConfig
    let data = worker_stake_config_account.try_borrow_data()?;
    let mut config: WorkerStakeConfig = read_account_data(&data, WorkerStakeAccountType::WorkerStakeConfig)?;
    drop(data);

    // Warning if new requirement exceeds current stake
    if new_min_stake_requirement > config.total_staked {
        msg!(
            "WARNING: new_min_stake_requirement ({}) exceeds current total_staked ({}). Worker will be ineligible to operate until additional stake is added.",
            new_min_stake_requirement,
            config.total_staked
        );
    }

    config.min_stake_requirement = new_min_stake_requirement;

    // Save updated config
    let mut data = worker_stake_config_account.try_borrow_mut_data()?;
    write_account_data(&mut data, WorkerStakeAccountType::WorkerStakeConfig, &config)?;

    msg!("Minimum stake requirement updated successfully to: {}", new_min_stake_requirement);
    Ok(())
}
