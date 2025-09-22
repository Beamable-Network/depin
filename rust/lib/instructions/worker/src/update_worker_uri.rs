use borsh::BorshDeserialize;
use mpl_bubblegum::types::LeafSchema;
use mpl_bubblegum::utils::get_asset_id;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::{rent::Rent, Sysvar}
};
use shared::{
    features::worker::accounts::WorkerMetadata, types::account::DepinAccountType, utils::{account::{read_account_data, reallocate_account_if_needed, write_account_data}, bgum::verify_license, bmb::validate_worker_tree}
};
use crate::input;

pub fn process_update_worker_uri<'info>(
    program_id: &Pubkey,
    accounts: &'info [AccountInfo<'info>],
    instruction_data: &[u8],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Worker metadata delegate (delegated_to from WorkerMetadata)
    // 1. [writable] WorkerMetadata PDA account (must exist)
    // 2. [readonly] mpl_account_compression program
    // 3. [readonly] Merkle tree account
    // 4. [readonly] System program account (for reallocation if needed)
    // N. [readonly] Proof accounts as remaining accounts
    let account_info_iter = &mut accounts.iter();
    let worker_delegate_account = next_account_info(account_info_iter)?;
    let worker_metadata_account = next_account_info(account_info_iter)?;
    let _mpl_account_compression_program_account = next_account_info(account_info_iter)?;
    let merkle_tree_account = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    let input = input::UpdateWorkerUriInput::try_from_slice(instruction_data)?;
    let license = input.license_context;

    // Calculate the leaf PDA (worker license)
    let leaf_asset_id = get_asset_id(merkle_tree_account.key, license.nonce);

    let license_leaf = LeafSchema::V2 {
        id: leaf_asset_id,
        owner: license.owner,
        delegate: license.delegate,
        nonce: license.nonce,
        data_hash: license.data_hash,
        creator_hash: license.creator_hash,
        collection_hash: license.collection_hash,
        asset_data_hash: license.asset_data_hash,
        flags: license.flags,
    };

    let license_leaf_hash = license_leaf.hash();

    // Collect remaining accounts as proof accounts
    let proof_accounts: Vec<AccountInfo> = account_info_iter.cloned().collect();

    let (worker_metadata_pda, _bump_seed) = WorkerMetadata::find_pda(program_id, &leaf_asset_id, &license.owner);

    // Validate WorkerMetadata PDA
    if *worker_metadata_account.key != worker_metadata_pda {
        msg!("Error: WorkerMetadata account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Check that WorkerMetadata account exists
    if worker_metadata_account.data_is_empty() {
        msg!("Error: WorkerMetadata account does not exist. Worker must be activated first.");
        return Err(ProgramError::UninitializedAccount);
    }

    // Read existing metadata
    let mut existing_metadata: WorkerMetadata = read_account_data(
        &worker_metadata_account.try_borrow_data()?,
         DepinAccountType::WorkerMetadata
    )?;

    // Check if worker is suspended
    if existing_metadata.suspended_at.is_some() {
        msg!("Error: Worker is currently suspended and cannot update discovery URI");
        return Err(ProgramError::InvalidAccountData);
    }

    // Check that the signer is the delegated_to address from WorkerMetadata
    if *worker_delegate_account.key != existing_metadata.delegated_to {
        msg!("Error: Signer must be the worker delegate (delegated_to from WorkerMetadata)");
        return Err(ProgramError::InvalidArgument);
    }

    // Check that the delegate is a signer
    if !worker_delegate_account.is_signer {
        msg!("Error: Worker delegate must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify tree and license proof
    validate_worker_tree(merkle_tree_account.key)?;
    verify_license(
        merkle_tree_account,
        &proof_accounts,
        license.root,
        license_leaf_hash,
        license.index,
    )?;

    // Update only the discovery URI, keep other fields unchanged
    existing_metadata.discovery_uri = input.discovery_uri;

    // Handle account reallocation if needed
    let rent = Rent::get()?;
    reallocate_account_if_needed(
        worker_delegate_account,
        worker_metadata_account,
        system_program,
        &rent,
        existing_metadata.len()
    )?;

    // Write updated metadata to the account
    let mut data = worker_metadata_account.try_borrow_mut_data()?;
    write_account_data(&mut data, WorkerMetadata::account_type(), &existing_metadata)?;

    msg!("Worker discovery URI updated successfully");
    Ok(())
}