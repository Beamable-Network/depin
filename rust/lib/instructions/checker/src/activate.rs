use borsh::BorshDeserialize;
use mpl_bubblegum::types::LeafSchema;
use mpl_bubblegum::utils::get_asset_id;
use solana_program::{
    account_info::{next_account_info, AccountInfo}, 
    entrypoint::ProgramResult, 
    msg, 
    program_error::ProgramError, 
    pubkey::Pubkey, 
    system_instruction, 
    sysvar::{rent::Rent, Sysvar}, 
    program::invoke_signed
};
use shared::{
    features::checker::accounts::CheckerMetadata, types::account::DepinAccountType, utils::{account::{read_account_data, reallocate_account_if_needed, write_account_data}, bgum::verify_license_and_owner, bmb::validate_checker_tree}
};
use crate::input;

pub fn process_activate_checker<'info>(
    program_id: &Pubkey,
    accounts: &'info [AccountInfo<'info>],
    instruction_data: &[u8],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Checker license owner  
    // 1. [writable] CheckerMetadata PDA account (will be created or updated)
    // 2. [readonly] mpl_account_compression program
    // 3. [readonly] Merkle tree account
    // 4. [readonly] System program account (for account creation)
    // N. [readonly] Proof accounts as remaining accounts
    let account_info_iter = &mut accounts.iter();
    let checker_owner_account = next_account_info(account_info_iter)?;
    let checker_metadata_account = next_account_info(account_info_iter)?;
    let _mpl_account_compression_program_account = next_account_info(account_info_iter)?;
    let merkle_tree_account = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    let input = input::ActivateCheckerInput::try_from_slice(instruction_data)?;
    let license = input.license_context;

    // Calculate the leaf PDA (checker license)
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

    // Verify tree
    validate_checker_tree(merkle_tree_account.key)?;

    // Verify leaf and owner
    verify_license_and_owner(
        merkle_tree_account,
        &proof_accounts,
        &license,
        license_leaf_hash,
        checker_owner_account,
    )?;

    let (checker_metadata_pda, bump_seed) = CheckerMetadata::find_pda(program_id, &leaf_asset_id, &license.owner);

    // Validate CheckerMetadata PDA
    if *checker_metadata_account.key != checker_metadata_pda {
        msg!("Error: CheckerMetadata account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    let metadata = CheckerMetadata {
        suspended_at: None,
        delegated_to: input.delegated_to,
    };

    // Check if CheckerMetadata already exists (upsert logic)
    let account_exists = !checker_metadata_account.data_is_empty();
    let rent = Rent::get()?;
    
    if account_exists {
        // Account exists - check if checker is suspended
        let existing_metadata: CheckerMetadata = read_account_data(
            &checker_metadata_account.try_borrow_data()?,
            DepinAccountType::CheckerMetadata
        )?;
        
        if existing_metadata.suspended_at.is_some() {
            msg!("Error: Checker is currently suspended and cannot be activated");
            return Err(ProgramError::InvalidAccountData);
        }
        
        // Handle account reallocation if needed
        reallocate_account_if_needed(
            checker_owner_account,
            checker_metadata_account,
            system_program,
            &rent,
            CheckerMetadata::LEN
        )?;
    } else {
        // Create new account
        let space = CheckerMetadata::LEN;
        msg!("Creating new CheckerMetadata account with space: {}", space);
        let rent_lamports = rent.minimum_balance(space);

        invoke_signed(
            &system_instruction::create_account(
                checker_owner_account.key,
                &checker_metadata_pda,
                rent_lamports,
                space as u64,
                program_id,
            ),
            &[
                checker_owner_account.clone(),
                checker_metadata_account.clone(),
                system_program.clone(),
            ],
            &[&[
                shared::constants::seeds::CHECKER_SEED,
                shared::constants::seeds::METADATA_SEED,
                leaf_asset_id.as_ref(),
                license.owner.as_ref(),
                &[bump_seed],
            ]],
        )?;
    }

    // Write metadata to the account
    let mut data = checker_metadata_account.try_borrow_mut_data()?;
    write_account_data(&mut data, CheckerMetadata::account_type(), &metadata)?;

    msg!("Checker activated successfully");
    Ok(())
}