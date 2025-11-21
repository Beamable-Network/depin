use depin_core::utils::{
    account::{read_account_data, write_account_data},
    validation::validate_pda_account,
};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    pubkey::Pubkey,
};
use crate::{
    state::worker_stake_config::WorkerStakeConfig,
    types::WorkerStakeAccountType,
    utils::validate_collection_authority,
};

pub fn process_update_worker_wallet<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    new_worker_wallet: Pubkey,
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Worker collection update authority
    // 1. [readonly] Worker collection account (Metaplex Core collection)
    // 2. [writable] WorkerStakeConfig PDA

    let account_info_iter = &mut accounts.iter();
    let collection_authority_account = next_account_info(account_info_iter)?;
    let worker_collection_account = next_account_info(account_info_iter)?;
    let worker_stake_config_account = next_account_info(account_info_iter)?;

    // Validate worker collection and authority
    validate_collection_authority(worker_collection_account, collection_authority_account)?;

    // Validate WorkerStakeConfig PDA
    let (config_pda, _bump) = WorkerStakeConfig::find_pda(program_id, worker_collection_account.key);
    validate_pda_account(worker_stake_config_account, &config_pda, "WorkerStakeConfig")?;

    // Load WorkerStakeConfig
    let data = worker_stake_config_account.try_borrow_data()?;
    let mut config: WorkerStakeConfig = read_account_data(&data, WorkerStakeAccountType::WorkerStakeConfig)?;
    drop(data);

    config.worker_wallet = new_worker_wallet;

    // Save updated config
    let mut data = worker_stake_config_account.try_borrow_mut_data()?;
    write_account_data(&mut data, WorkerStakeAccountType::WorkerStakeConfig, &config)?;

    msg!("Worker wallet updated successfully to: {}", new_worker_wallet);
    Ok(())
}
