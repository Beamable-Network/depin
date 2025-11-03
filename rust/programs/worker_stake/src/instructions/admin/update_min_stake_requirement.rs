use depin_core::utils::{
    account::{read_account_data, write_account_data},
    program_data::validate_upgrade_authority,
};
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
    utils::{validate_pda_account, require_signer},
};

pub fn process_update_min_stake_requirement<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    worker_collection: Pubkey,
    new_min_stake_requirement: u64,
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Program upgrade authority
    // 1. [readonly] ProgramData account (contains upgrade authority)
    // 2. [writable] WorkerStakeConfig PDA
    let account_info_iter = &mut accounts.iter();
    let upgrade_authority_account = next_account_info(account_info_iter)?;
    let program_data_account = next_account_info(account_info_iter)?;
    let worker_stake_config_account = next_account_info(account_info_iter)?;

    // Validate upgrade authority signature
    require_signer(upgrade_authority_account, "Program upgrade authority")?;

    // Validate upgrade authority from ProgramData account
    validate_upgrade_authority(
        program_id,
        program_data_account,
        upgrade_authority_account.key
    )?;

    // Validate new_min_stake_requirement > 0
    if new_min_stake_requirement == 0 {
        msg!("Error: new_min_stake_requirement must be greater than 0");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate WorkerStakeConfig PDA
    let (config_pda, _bump) = WorkerStakeConfig::find_pda(program_id, &worker_collection);
    validate_pda_account(worker_stake_config_account, &config_pda, "WorkerStakeConfig")?;

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
