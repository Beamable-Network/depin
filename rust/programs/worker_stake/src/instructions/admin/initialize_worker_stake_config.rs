use depin_core::{constants::NETWORK_ADMIN, utils::account::write_account_data};
use solana_program::{
    account_info::{AccountInfo, next_account_info},
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
    state::worker_stake_config::WorkerStakeConfig,
    types::WorkerStakeAccountType,
    utils::{validate_collection_authority},
};

pub fn process_initialize_worker_stake_config<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    worker_wallet: Pubkey,
    min_stake_requirement: u64,
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Worker collection update authority
    // 1. [signer] Network admin
    // 2. [readonly] Worker collection account (Metaplex Core collection)
    // 3. [writable] WorkerStakeConfig PDA
    // 4. [readonly] System program

    let account_info_iter = &mut accounts.iter();
    let collection_authority_account = next_account_info(account_info_iter)?;
    let network_admin_account = next_account_info(account_info_iter)?;
    let worker_collection_account = next_account_info(account_info_iter)?;
    let worker_stake_config_account = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

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

    // Validate worker collection and authority
    validate_collection_authority(worker_collection_account, collection_authority_account)?;

    // Validate WorkerStakeConfig PDA
    let (config_pda, config_bump) = WorkerStakeConfig::find_pda(program_id, worker_collection_account.key);
    if *worker_stake_config_account.key != config_pda {
        msg!("Error: WorkerStakeConfig account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate WorkerStakeConfig doesn't already exist
    if !worker_stake_config_account.data_is_empty() {
        msg!("Error: WorkerStakeConfig already exists");
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    // Create WorkerStakeConfig account
    let rent = Rent::get()?;
    let space = WorkerStakeConfig::required_size(0);
    let rent_lamports = rent.minimum_balance(space);

    msg!("Creating WorkerStakeConfig PDA");
    invoke_signed(
        &system_instruction::create_account(
            collection_authority_account.key,
            &config_pda,
            rent_lamports,
            space as u64,
            program_id,
        ),
        &[
            collection_authority_account.clone(),
            worker_stake_config_account.clone(),
            system_program.clone(),
        ],
        &[&[
            WorkerStakeConfig::SEED,
            worker_collection_account.key.as_ref(),
            &[config_bump],
        ]],
    )?;

    // Initialize WorkerStakeConfig data
    let config = WorkerStakeConfig::new(
        *worker_collection_account.key,
        worker_wallet,
        min_stake_requirement,
    );

    let mut data = worker_stake_config_account.try_borrow_mut_data()?;
    write_account_data(&mut data, WorkerStakeAccountType::WorkerStakeConfig, &config)?;

    msg!("WorkerStakeConfig created successfully");
    Ok(())
}
