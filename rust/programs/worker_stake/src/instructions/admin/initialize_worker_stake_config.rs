use depin_core::utils::{
    account::write_account_data,
    program_data::validate_upgrade_authority,
};
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
};

pub fn process_initialize_worker_stake_config<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    worker_collection: Pubkey,
    worker_wallet: Pubkey,
    min_stake_requirement: u64,
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Program upgrade authority
    // 1. [readonly] ProgramData account (contains upgrade authority)
    // 2. [writable, signer] Payer (pays for account creation)
    // 3. [writable] WorkerStakeConfig PDA
    // 4. [readonly] System program

    let account_info_iter = &mut accounts.iter();
    let upgrade_authority_account = next_account_info(account_info_iter)?;
    let program_data_account = next_account_info(account_info_iter)?;
    let payer_account = next_account_info(account_info_iter)?;
    let worker_stake_config_account = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    // Validate upgrade authority signature
    if !upgrade_authority_account.is_signer {
        msg!("Error: Program upgrade authority must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate upgrade authority from ProgramData account
    validate_upgrade_authority(
        program_id,
        program_data_account,
        upgrade_authority_account.key
    )?;

    // Validate WorkerStakeConfig PDA
    let (config_pda, config_bump) = WorkerStakeConfig::find_pda(program_id, &worker_collection);
    if *worker_stake_config_account.key != config_pda {
        msg!("Error: WorkerStakeConfig account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate WorkerStakeConfig doesn't already exist
    if !worker_stake_config_account.data_is_empty() {
        msg!("Error: WorkerStakeConfig already exists");
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    // Validate payer is signer
    if !payer_account.is_signer {
        msg!("Error: Payer must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Create WorkerStakeConfig account
    let rent = Rent::get()?;
    let space = WorkerStakeConfig::required_size(0);
    let rent_lamports = rent.minimum_balance(space);

    msg!("Creating WorkerStakeConfig PDA");
    invoke_signed(
        &system_instruction::create_account(
            payer_account.key,
            &config_pda,
            rent_lamports,
            space as u64,
            program_id,
        ),
        &[
            payer_account.clone(),
            worker_stake_config_account.clone(),
            system_program.clone(),
        ],
        &[&[
            WorkerStakeConfig::SEED,
            worker_collection.as_ref(),
            &[config_bump],
        ]],
    )?;

    // Initialize WorkerStakeConfig data
    let config = WorkerStakeConfig::new(
        worker_collection,
        worker_wallet,
        min_stake_requirement,
    );

    let mut data = worker_stake_config_account.try_borrow_mut_data()?;
    write_account_data(&mut data, WorkerStakeAccountType::WorkerStakeConfig, &config)?;

    msg!("WorkerStakeConfig created successfully");
    Ok(())
}
