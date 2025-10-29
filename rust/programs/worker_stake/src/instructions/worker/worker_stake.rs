use depin_core::{
    constants::BMB_MINT,
    utils::{
        account::{read_account_data, write_account_data},
        tokens::initialize_ata_if_needed,
    },
};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use spl_token::instruction::transfer_checked;
use crate::{
    state::worker_stake_config::WorkerStakeConfig,
    types::WorkerStakeAccountType,
    utils::{validate_collection_authority, find_worker_stake_vault_pda},
};

pub fn process_worker_stake<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    amount: u64,
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer, writable] Worker collection update authority (payer for ATA)
    // 1. [readonly] Worker collection account (Metaplex Core collection)
    // 2. [writable] WorkerStakeConfig PDA
    // 3. [writable] Worker token account (source ATA for BMB)
    // 4. [readonly] Worker stake vault PDA (authority)
    // 5. [writable] Worker stake vault ATA (destination for BMB)
    // 6. [readonly] BMB mint
    // 7. [readonly] Token program
    // 8. [readonly] Associated token program
    // 9. [readonly] System program

    let account_info_iter = &mut accounts.iter();
    let collection_authority_account = next_account_info(account_info_iter)?;
    let worker_collection_account = next_account_info(account_info_iter)?;
    let worker_stake_config_account = next_account_info(account_info_iter)?;
    let worker_token_account = next_account_info(account_info_iter)?;
    let worker_stake_vault_pda = next_account_info(account_info_iter)?;
    let worker_stake_vault_ata = next_account_info(account_info_iter)?;
    let bmb_mint_account = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;
    let associated_token_program = next_account_info(account_info_iter)?;
    let _system_program = next_account_info(account_info_iter)?;

    // Validate amount > 0
    if amount == 0 {
        msg!("Error: Amount must be greater than 0");
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

    // Validate BMB mint
    if *bmb_mint_account.key != BMB_MINT {
        msg!("Error: Invalid BMB mint");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate worker stake vault PDA
    let (expected_vault_pda, _vault_bump) = find_worker_stake_vault_pda(program_id, worker_collection_account.key);
    if *worker_stake_vault_pda.key != expected_vault_pda {
        msg!("Error: Worker stake vault PDA does not match expected address");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate worker stake vault ATA matches derived address
    let expected_vault_ata = spl_associated_token_account::get_associated_token_address(
        worker_stake_vault_pda.key,
        bmb_mint_account.key,
    );
    if *worker_stake_vault_ata.key != expected_vault_ata {
        msg!("Error: Worker stake vault ATA does not match expected address");
        return Err(ProgramError::InvalidArgument);
    }

    // Initialize worker stake vault ATA if needed (lazy initialization)
    initialize_ata_if_needed(
        collection_authority_account,
        worker_stake_vault_pda,
        bmb_mint_account,
        worker_stake_vault_ata,
        token_program,
        associated_token_program,
    )?;

    // Transfer BMB from worker to worker stake vault
    let transfer_ix = transfer_checked(
        token_program.key,
        worker_token_account.key,
        bmb_mint_account.key,
        worker_stake_vault_ata.key,
        collection_authority_account.key,
        &[],
        amount,
        depin_core::constants::BMB_DECIMALS,
    )?;

    invoke(
        &transfer_ix,
        &[
            worker_token_account.clone(),
            bmb_mint_account.clone(),
            worker_stake_vault_ata.clone(),
            collection_authority_account.clone(),
            token_program.clone(),
        ],
    )?;

    // Load and update config
    let data = worker_stake_config_account.try_borrow_data()?;
    let mut config: WorkerStakeConfig = read_account_data(&data, WorkerStakeAccountType::WorkerStakeConfig)?;
    drop(data);

    config.total_staked = config.total_staked
        .checked_add(amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // Save updated config
    let mut data = worker_stake_config_account.try_borrow_mut_data()?;
    write_account_data(&mut data, WorkerStakeAccountType::WorkerStakeConfig, &config)?;

    msg!("Worker staked {} BMB. Total staked: {}", amount, config.total_staked);
    Ok(())
}
