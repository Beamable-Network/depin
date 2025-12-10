use borsh::BorshDeserialize;
use mpl_bubblegum::types::LeafSchema;
use mpl_bubblegum::utils::get_asset_id;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::{rent::Rent, Sysvar},
    program::invoke_signed
};
use solana_system_interface::instruction as system_instruction;
use crate::shared::{
    features::worker::accounts::WorkerMetadata,
    features::global::accounts::BMBState,
};
use depin_core::{
    types::account::DepinAccountType,
    utils::{
        account::{read_account_data, reallocate_account_if_needed, write_account_data},
        bgum::verify_license_and_owner,
        bmb::validate_worker_tree
    }
};
use super::input;

pub fn process_activate_worker<'info>(
    program_id: &Pubkey,
    accounts: &'info [AccountInfo<'info>],
    instruction_data: &[u8],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Worker license owner  
    // 1. [writable] WorkerMetadata PDA account (will be created or updated)
    // 2. [readonly] mpl_account_compression program
    // 3. [readonly] Merkle tree account
    // 4. [writable] BMBState PDA account
    // 5. [readonly] System program account (for account creation)
    // N. [readonly] Proof accounts as remaining accounts
    let account_info_iter = &mut accounts.iter();
    let worker_owner_account = next_account_info(account_info_iter)?;
    let worker_metadata_account = next_account_info(account_info_iter)?;
    let _mpl_account_compression_program_account = next_account_info(account_info_iter)?;
    let merkle_tree_account = next_account_info(account_info_iter)?;
    let bmb_state_account = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    let input = input::ActivateWorkerInput::try_from_slice(instruction_data)?;
    let license = input.license_context;

    // Validate BMBState PDA
    let (bmb_state_pda, _) = BMBState::find_pda(program_id);
    if *bmb_state_account.key != bmb_state_pda {
        msg!("Error: BMBState account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    if !bmb_state_account.is_writable {
        msg!("Error: BMBState account must be writable");
        return Err(ProgramError::InvalidArgument);
    }

    if bmb_state_account.data_is_empty() {
        msg!("Error: BMBState account is not initialized");
        return Err(ProgramError::UninitializedAccount);
    }

    // Calculate the leaf PDA (worker license)
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

    // Collect remaining accounts as proof accounts
    let proof_accounts: Vec<AccountInfo> = account_info_iter.cloned().collect();

    // Verify tree
    validate_worker_tree(merkle_tree_account.key)?;

    // Verify leaf and owner
    verify_license_and_owner(
        merkle_tree_account,
        &proof_accounts,
        &license,
        license_leaf_hash,
        worker_owner_account,
    )?;

    let (worker_metadata_pda, bump_seed) = WorkerMetadata::find_pda(program_id, &leaf_asset_id, &license.owner);

    // Validate WorkerMetadata PDA
    if *worker_metadata_account.key != worker_metadata_pda {
        msg!("Error: WorkerMetadata account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    let metadata = WorkerMetadata {
        suspended_at: None,
        delegated_to: input.delegated_to,
        discovery_uri: input.discovery_uri,
        license: leaf_asset_id,
        owner: license.owner,
    };

    // Check if WorkerMetadata already exists (upsert logic)
    let account_exists = !worker_metadata_account.data_is_empty();
    let rent = Rent::get()?;
    
    if account_exists {
        // Account exists - check if worker is suspended
        let existing_metadata: WorkerMetadata = read_account_data(
            &worker_metadata_account.try_borrow_data()?, 
             DepinAccountType::WorkerMetadata
        )?;
        
        if existing_metadata.suspended_at.is_some() {
            msg!("Error: Worker is currently suspended and cannot be activated");
            return Err(ProgramError::InvalidAccountData);
        }
        
        // Handle account reallocation if needed
        reallocate_account_if_needed(
            worker_owner_account,
            worker_metadata_account,
            system_program,
            &rent,
            metadata.len()
        )?;
    } else {
        // Create new account
        let space = metadata.len();
        msg!("Creating new WorkerMetadata account with space: {}", space);
        let rent_lamports = rent.minimum_balance(space);

        invoke_signed(
            &system_instruction::create_account(
                worker_owner_account.key,
                &worker_metadata_pda,
                rent_lamports,
                space as u64,
                program_id,
            ),
            &[
                worker_owner_account.clone(),
                worker_metadata_account.clone(),
                system_program.clone(),
            ],
            &[&[
                crate::shared::constants::seeds::WORKER_SEED,
                crate::shared::constants::seeds::METADATA_SEED,
                leaf_asset_id.as_ref(),
                license.owner.as_ref(),
                &[bump_seed],
            ]],
        )?;

        // Increment workers_activated in BMBState for new worker
        let mut bmb_state: BMBState = read_account_data(
            &bmb_state_account.try_borrow_data()?,
            DepinAccountType::BMBState
        )?;
        
        bmb_state.workers_activated = bmb_state.workers_activated
            .checked_add(1)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        
        let mut bmb_data = bmb_state_account.try_borrow_mut_data()?;
        write_account_data(&mut bmb_data, BMBState::account_type(), &bmb_state)?;
    }

    // Write metadata to the account
    let mut data = worker_metadata_account.try_borrow_mut_data()?;
    write_account_data(&mut data, WorkerMetadata::account_type(), &metadata)?;

    msg!("Worker activated successfully");
    Ok(())
}
