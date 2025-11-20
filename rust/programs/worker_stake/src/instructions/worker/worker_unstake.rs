use depin_core::{
    constants::BMB_MINT,
    utils::account::{read_account_data, write_account_data},
};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    program_pack::Pack,
};
use spl_token::instruction::transfer_checked;
use crate::{
    state::worker_stake_config::WorkerStakeConfig,
    types::WorkerStakeAccountType,
    utils::{validate_collection_authority, find_worker_stake_vault_pda, WORKER_STAKE_VAULT_SEED},
};

pub fn process_worker_unstake<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    amount: u64,
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Worker collection update authority
    // 1. [readonly] Worker collection account (Metaplex Core collection)
    // 2. [writable] WorkerStakeConfig PDA
    // 3. [readonly] Worker stake vault PDA (authority)
    // 4. [writable] Worker stake vault ATA (source for BMB)
    // 5. [writable] Worker token account (destination ATA for BMB)
    // 6. [readonly] BMB mint
    // 7. [readonly] Token program

    let account_info_iter = &mut accounts.iter();
    let collection_authority_account = next_account_info(account_info_iter)?;
    let worker_collection_account = next_account_info(account_info_iter)?;
    let worker_stake_config_account = next_account_info(account_info_iter)?;
    let worker_stake_vault_pda = next_account_info(account_info_iter)?;
    let worker_stake_vault_ata = next_account_info(account_info_iter)?;
    let worker_token_account = next_account_info(account_info_iter)?;
    let bmb_mint_account = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;

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
    let (expected_vault_pda, vault_bump) = find_worker_stake_vault_pda(program_id, worker_collection_account.key);
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

    // Load config
    let data = worker_stake_config_account.try_borrow_data()?;
    let mut config: WorkerStakeConfig = read_account_data(&data, WorkerStakeAccountType::WorkerStakeConfig)?;
    drop(data);

    let new_total_staked = config.total_staked
        .checked_sub(amount)
        .ok_or(ProgramError::InsufficientFunds)?;

    // Validate amount <= worker_stake_vault.amount (will be checked by token program, but explicit check helps)
    let vault_data = worker_stake_vault_ata.try_borrow_data()?;
    let vault_account = spl_token::state::Account::unpack(&vault_data)?;
    drop(vault_data);

    if amount > vault_account.amount {
        msg!("Error: Insufficient balance in worker stake vault");
        return Err(ProgramError::InsufficientFunds);
    }

    // Transfer BMB from worker stake vault to worker (PDA must sign)
    let transfer_ix = transfer_checked(
        token_program.key,
        worker_stake_vault_ata.key,
        bmb_mint_account.key,
        worker_token_account.key,
        worker_stake_vault_pda.key,
        &[],
        amount,
        depin_core::constants::BMB_DECIMALS,
    )?;

    let signer_seeds = &[
        WORKER_STAKE_VAULT_SEED,
        worker_collection_account.key.as_ref(),
        &[vault_bump],
    ];

    invoke_signed(
        &transfer_ix,
        &[
            worker_stake_vault_ata.clone(),
            bmb_mint_account.clone(),
            worker_token_account.clone(),
            worker_stake_vault_pda.clone(),
            token_program.clone(),
        ],
        &[signer_seeds],
    )?;

    // Update config
    config.total_staked = new_total_staked;

    // Save updated config
    let mut data = worker_stake_config_account.try_borrow_mut_data()?;
    write_account_data(&mut data, WorkerStakeAccountType::WorkerStakeConfig, &config)?;

    msg!("Worker unstaked {} BMB. Total staked: {}", amount, config.total_staked);
    Ok(())
}
