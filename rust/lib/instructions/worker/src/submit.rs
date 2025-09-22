use crate::input;
use borsh::BorshDeserialize;
use mpl_bubblegum::types::LeafSchema;
use mpl_bubblegum::utils::get_asset_id;
use shared::{
    features::{
        global::accounts::BMBState,
        rewards::accounts::GlobalRewards,
        worker::accounts::{WorkerLicenseMetadata, WorkerMetadata, WorkerProof},
    }, utils::{
        account::{read_account_data, write_account_data},
        bgum::verify_license, bmb::validate_worker_tree,
    }
};
use solana_program::{
    account_info::{next_account_info, AccountInfo}, entrypoint::ProgramResult, msg, program::invoke_signed, program_error::ProgramError, pubkey::Pubkey, system_instruction, sysvar::{rent::Rent, Sysvar}
};

pub fn process_submit_worker_proof(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Worker delegate
    // 1. [writable] Global rewards account
    // 2. [writable] WorkerProof PDA account (will be created)
    // 3. [readonly] WorkerMetadata PDA account
    // 4. [readonly] WorkerLicenseMetadata PDA account
    // 5. [readonly] mpl_account_compression program
    // 6. [readonly] Merkle tree account
    // 7. [readonly] BMBState account
    // 8. [readonly] System program account (for account creation)
    // N. [readonly] Proof accounts as remaining accounts
    let account_info_iter = &mut accounts.iter();
    let worker_delegate_account = next_account_info(account_info_iter)?;
    let global_rewards_account = next_account_info(account_info_iter)?;
    let worker_proof_account = next_account_info(account_info_iter)?;
    let worker_metadata_account = next_account_info(account_info_iter)?;
    let worker_license_metadata_account = next_account_info(account_info_iter)?;
    let _mpl_account_compression_program_account = next_account_info(account_info_iter)?;
    let merkle_tree_account = next_account_info(account_info_iter)?;
    let bmb_state_account = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    // Collect remaining accounts as proof accounts
    let proof_accounts: Vec<AccountInfo> = account_info_iter.cloned().collect();

    // Check worker delegate is signer
    if !worker_delegate_account.is_signer {
        msg!("Error: Worker delegate must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    let input = input::SubmitWorkerProofInput::try_from_slice(instruction_data)?;
    let license = input.license_context;

    // Calculate the leaf PDA
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

    // Verify tree
    validate_worker_tree(merkle_tree_account.key)?;

    // Verify leaf
    verify_license(
        merkle_tree_account,
        &proof_accounts,
        license.root,
        license_leaf_hash,
        license.index,
    )?;

    // Validate worker metadata and delegate authorization
    validate_worker_metadata_and_delegate(
        program_id,
        worker_metadata_account,
        worker_delegate_account,
        &leaf_asset_id,
        &license.owner,
    )?;

    // Validate worker license metadata
    validate_worker_license_metadata(
        program_id,
        worker_license_metadata_account,
        &leaf_asset_id
    )?;

    let current_period = shared::utils::bmb::get_current_period();

    // Workers can only submit for the previous period (current_period - 1)
    // This gives them 24h from period end to submit
    if input.period != current_period - 1 {
        msg!("Error: Can only submit proof for the previous period, current period is {}, given period is {}", current_period, input.period);
        return Err(ProgramError::InvalidArgument);
    }

    let (worker_pda, bump_seed) = WorkerProof::find_pda(program_id, &leaf_asset_id, input.period);

    // Validate WorkerProof PDA
    if *worker_proof_account.key != worker_pda {
        msg!("Error: WorkerProof account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Check if WorkerProof already exists, if so - throw an error
    if !worker_proof_account.data_is_empty() {
        msg!("Error: WorkerProof already exists for this worker and period");
        return Err(ProgramError::AccountAlreadyInitialized);
    }    

    // Create the WorkerProof account
    let rent = Rent::get()?;
    let space = WorkerProof::LEN;
    let rent_lamports = rent.minimum_balance(space);

    invoke_signed(
        &system_instruction::create_account(
            worker_delegate_account.key,
            &worker_pda,
            rent_lamports,
            space as u64,
            program_id,
        ),
        &[
            worker_delegate_account.clone(),
            worker_proof_account.clone(),
            system_program.clone(),
        ],
        &[&[
            shared::constants::seeds::PROOF_SEED,
            &input.period.to_le_bytes(),
            leaf_asset_id.as_ref(),
            &[bump_seed],
        ]],
    )?;

    let proof_data = WorkerProof {
        period: input.period,
        proof_root: input.proof_root,
        checkers: input.checkers,
        latency: input.latency,
        uptime: input.uptime,
    };

    // Write proof data to the account
    let mut data = worker_proof_account.try_borrow_mut_data()?;
    write_account_data(&mut data, WorkerProof::account_type(), &proof_data)?;

    update_checker_rewards(
        program_id,
        global_rewards_account,
        bmb_state_account,
        &leaf_asset_id,
        input.period,
        input.checkers,
    )?;

    Ok(())
}

fn update_checker_rewards(
    program_id: &Pubkey,
    global_rewards_account: &AccountInfo,
    bmb_state_account: &AccountInfo,
    leaf_asset_id: &Pubkey,
    period: u16,
    checkers: [u64; 8],
) -> ProgramResult {    
    let (bmb_state_pda, _) = BMBState::find_pda(program_id);
    if bmb_state_account.key != &bmb_state_pda {
        msg!("Error: BMBState account does not match expected PDA");
        return Err(solana_program::program_error::ProgramError::InvalidArgument);
    }

    // Check if BMBState account is empty
    if bmb_state_account.data_is_empty() {
        msg!("Error: BMBState account is not initialized");
        return Err(ProgramError::UninitializedAccount);
    }

    // Fetch the number of activated checkers for this period from BMBState
    let bmb_state: BMBState = read_account_data(
        &bmb_state_account.try_borrow_data()?,
        BMBState::account_type(),
    )?;

    let checker_count = bmb_state
        .get_checker_count_for_period(period)
        .ok_or_else(|| {
            msg!("Error: No checker count available for target period");
            ProgramError::InvalidAccountData
        })?;

    // Run BRAND
    let numbers = shared::utils::brand::generate_numbers(
        leaf_asset_id.as_ref(),
        period,
        512,
        checker_count as u64,
    );

    // Fetch and modify checkers in the global rewards account
    let (global_rewards_pda, _) = GlobalRewards::find_pda(program_id);

    if global_rewards_account.key != &global_rewards_pda {
        msg!("Error: Global rewards account does not match expected PDA");
        return Err(solana_program::program_error::ProgramError::InvalidArgument);
    }

    let mut global_rewards_data = global_rewards_account.try_borrow_mut_data()?;
    let period_reward_tokens = GlobalRewards::get_checker_reward(period);
    
    // Iterate through the bitmap and increment rewards for selected checkers
    for (array_index, &checker_bits) in checkers.iter().enumerate() {
        if checker_bits == 0 {
            continue; // Skip empty u64s
        }

        let mut bits = checker_bits;
        let base_bit_index = array_index * 64;

        // Process all set bits in this u64
        while bits != 0 {
            let bit_position = bits.trailing_zeros() as usize;
            let bit_index = base_bit_index + bit_position;

            let checker_index = numbers[bit_index] as usize;

            GlobalRewards::add_checker_balance(&mut global_rewards_data, checker_index, period_reward_tokens as u32)?;

            // Clear the processed bit
            bits &= bits - 1;
        }
    }

    Ok(())
}

fn validate_worker_metadata_and_delegate(
    program_id: &Pubkey,
    worker_metadata_account: &AccountInfo,
    worker_delegate_account: &AccountInfo,
    leaf_asset_id: &Pubkey,
    license_owner: &Pubkey,
) -> ProgramResult {
    // Calculate expected WorkerMetadata PDA
    let (worker_metadata_pda, _) =
        WorkerMetadata::find_pda(program_id, leaf_asset_id, license_owner);

    // Validate WorkerMetadata PDA
    if *worker_metadata_account.key != worker_metadata_pda {
        msg!("Error: WorkerMetadata account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Check if WorkerMetadata exists
    if worker_metadata_account.data_is_empty() {
        msg!("Error: WorkerMetadata account does not exist. Worker must be activated first");
        return Err(ProgramError::UninitializedAccount);
    }

    // Read WorkerMetadata to check delegation
    let worker_metadata: WorkerMetadata = read_account_data(
        &worker_metadata_account.try_borrow_data()?,
        WorkerMetadata::account_type(),
    )?;

    // Check that the signer is authorized to submit proofs for this worker
    if *worker_delegate_account.key != worker_metadata.delegated_to {
        msg!("Error: Transaction signer is not authorized to submit proofs for this worker");
        return Err(ProgramError::MissingRequiredSignature);
    }

    Ok(())
}

fn validate_worker_license_metadata(
    program_id: &Pubkey,
    worker_license_metadata_account: &AccountInfo,
    leaf_asset_id: &Pubkey
) -> ProgramResult {
    // Calculate expected WorkerMetadata PDA
    let (worker_license_metadata_pda, _) =
        WorkerLicenseMetadata::find_pda(program_id, leaf_asset_id);

    // Validate WorkerLicenseMetadata PDA
    if *worker_license_metadata_account.key != worker_license_metadata_pda {
        msg!("Error: WorkerLicenseMetadata account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Check if WorkerMetadata exists
    if !worker_license_metadata_account.data_is_empty() {                
        let worker_license_metadata: WorkerLicenseMetadata = read_account_data(
            &worker_license_metadata_account.try_borrow_data()?,
            WorkerLicenseMetadata::account_type(),
        )?;

        if worker_license_metadata.suspended_at.is_some() {
            msg!("Error: WorkerLicense is suspended");
            return Err(ProgramError::InvalidAccountData);
        }
    }
    Ok(())
}