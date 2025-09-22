use borsh::BorshDeserialize;
use mpl_bubblegum::{types::LeafSchema, utils::get_asset_id};
use solana_program::{
    account_info::{next_account_info, AccountInfo}, 
    entrypoint::ProgramResult, 
    msg, 
    program_error::ProgramError, 
    pubkey::Pubkey
};
use shared::{
    features::{
        bubblegum::cnft_context::CnftContext,
        checker::accounts::{CheckerLicenseMetadata, CheckerMetadata},
        rewards::accounts::GlobalRewards,
        treasury::{accounts::TreasuryConfig, utils::grant_locked}
    },
    utils::{account::read_account_data, bgum::verify_license, bmb::validate_checker_tree}
};
use crate::input;

pub fn process_payout_checker_rewards<'info>(
    program_id: &Pubkey,
    accounts: &'info [AccountInfo<'info>],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts and input
    let accounts = parse_accounts(accounts)?;
    let input = input::PayoutCheckerRewardsInput::try_from_slice(instruction_data)?;

    // Validate all preconditions
    validate_payout_preconditions(program_id, &accounts, &input)?;

    // Get checker balance and validate it's not zero
    let checker_index = input.license_context.index as usize;
    let payout_amount = get_and_validate_checker_balance(accounts.global_rewards, checker_index)?;

    // Execute the payout
    execute_payout(program_id, &accounts, &input, payout_amount)?;

    // Reset balance and log success
    reset_checker_balance(accounts.global_rewards, checker_index)?;
    msg!("Successfully paid out {} BMB as locked tokens to checker (12-month lock)", payout_amount);

    Ok(())
}

struct PayoutAccounts<'info> {
    signer: &'info AccountInfo<'info>,
    global_rewards: &'info AccountInfo<'info>,
    checker_metadata: &'info AccountInfo<'info>,
    checker_license_metadata: &'info AccountInfo<'info>,
    merkle_tree: &'info AccountInfo<'info>,
    system_program: &'info AccountInfo<'info>,
    treasury_state: &'info AccountInfo<'info>,
    treasury_ata: &'info AccountInfo<'info>,
    treasury_config: &'info AccountInfo<'info>,
    locked_tokens: &'info AccountInfo<'info>,
    proof_accounts: Vec<AccountInfo<'info>>,
}

fn parse_accounts<'info>(accounts: &'info [AccountInfo<'info>]) -> Result<PayoutAccounts<'info>, ProgramError> {
    // Expected Accounts:
    // 0. [signer] Signer (license owner or delegate)
    // 1. [writable] Global rewards account
    // 2. [writable] CheckerMetadata PDA account
    // 3. [readonly] CheckerLicenseMetadata PDA account
    // 4. [readonly] mpl_account_compression program
    // 5. [readonly] Merkle tree account
    // 6. [readonly] System program account (for account creation)
    // 7. [writable] TreasuryState PDA account
    // 8. [writable] Treasury ATA account (treasury authority's associated token account)
    // 9. [readonly] TreasuryConfig PDA account
    // 10. [writable] LockedTokens PDA account (will be created)
    // N. [readonly] Proof accounts as remaining accounts

    let mut account_info_iter = accounts.iter();
    let signer = next_account_info(&mut account_info_iter)?;
    let global_rewards = next_account_info(&mut account_info_iter)?;
    let checker_metadata = next_account_info(&mut account_info_iter)?;
    let checker_license_metadata = next_account_info(&mut account_info_iter)?;
    let _mpl_account_compression_program = next_account_info(&mut account_info_iter)?;
    let merkle_tree = next_account_info(&mut account_info_iter)?;
    let system_program = next_account_info(&mut account_info_iter)?;
    let treasury_state = next_account_info(&mut account_info_iter)?;
    let treasury_ata = next_account_info(&mut account_info_iter)?;
    let treasury_config = next_account_info(&mut account_info_iter)?;
    let locked_tokens = next_account_info(&mut account_info_iter)?;

    // Collect remaining accounts as proof accounts
    let proof_accounts: Vec<AccountInfo> = account_info_iter.cloned().collect();

    // Check signer is present
    if !signer.is_signer {
        msg!("Error: Transaction must be signed");
        return Err(ProgramError::MissingRequiredSignature);
    }

    Ok(PayoutAccounts {
        signer,
        global_rewards,
        checker_metadata,
        checker_license_metadata,
        merkle_tree,
        system_program,
        treasury_state,
        treasury_ata,
        treasury_config,
        locked_tokens,
        proof_accounts,
    })
}

fn validate_payout_preconditions(
    program_id: &Pubkey,
    accounts: &PayoutAccounts,
    input: &input::PayoutCheckerRewardsInput,
) -> ProgramResult {
    let license = &input.license_context;
    let leaf_asset_id = get_asset_id(accounts.merkle_tree.key, license.nonce);

    // Validate license and tree
    validate_license_and_tree(accounts, license, &leaf_asset_id)?;

    // Validate all metadata accounts
    validate_metadata_accounts(program_id, accounts, &leaf_asset_id, &license.owner)?;

    // Validate global rewards account
    validate_global_rewards_account(program_id, accounts.global_rewards)?;

    Ok(())
}

fn validate_license_and_tree(
    accounts: &PayoutAccounts,
    license: &CnftContext,
    leaf_asset_id: &Pubkey,
) -> ProgramResult {
    // Build license leaf schema
    let license_leaf = LeafSchema::V2 {
        id: *leaf_asset_id,
        owner: license.owner,
        delegate: license.delegate,
        nonce: license.nonce,
        data_hash: license.data_hash,
        creator_hash: license.creator_hash,
        collection_hash: license.collection_hash,
        asset_data_hash: license.asset_data_hash,
        flags: license.flags,
    };

    // Validate tree
    validate_checker_tree(accounts.merkle_tree.key)?;

    // Verify license
    verify_license(
        accounts.merkle_tree,
        &accounts.proof_accounts,
        license.root,
        license_leaf.hash(),
        license.index,
    )?;

    Ok(())
}

fn validate_metadata_accounts(
    program_id: &Pubkey,
    accounts: &PayoutAccounts,
    leaf_asset_id: &Pubkey,
    license_owner: &Pubkey,
) -> ProgramResult {
    // Validate checker metadata and authorization (owner or delegate)
    validate_checker_metadata_and_authorization(
        program_id,
        accounts.checker_metadata,
        accounts.signer,
        leaf_asset_id,
        license_owner,
    )?;

    // Validate checker license metadata
    validate_checker_license_metadata(
        program_id,
        accounts.checker_license_metadata,
        leaf_asset_id,
    )?;

    Ok(())
}

fn validate_global_rewards_account(program_id: &Pubkey, global_rewards_account: &AccountInfo) -> ProgramResult {
    let (global_rewards_pda, _) = GlobalRewards::find_pda(program_id);
    if global_rewards_account.key != &global_rewards_pda {
        msg!("Error: Global rewards account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }
    Ok(())
}


fn get_and_validate_checker_balance(global_rewards_account: &AccountInfo, checker_index: usize) -> Result<u64, ProgramError> {
    let checker_balance = {
        let global_rewards_data = global_rewards_account.try_borrow_data()?;
        GlobalRewards::read_checker_balance(&global_rewards_data, checker_index)?
    };

    msg!("Checker {} has balance: {}", checker_index, checker_balance);

    if checker_balance == 0 {
        msg!("Error: Checker {} has no balance", checker_index);
        return Err(ProgramError::InsufficientFunds);
    }

    Ok(checker_balance as u64)
}

fn execute_payout(
    program_id: &Pubkey,
    accounts: &PayoutAccounts,
    input: &input::PayoutCheckerRewardsInput,
    payout_amount: u64,
) -> ProgramResult {
    // Read lock duration days from TreasuryConfig
    let (treasury_config_pda, _) = TreasuryConfig::find_pda(program_id);
    if accounts.treasury_config.key != &treasury_config_pda {
        msg!("Error: TreasuryConfig account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    if accounts.treasury_config.data_is_empty() {
        msg!("Error: TreasuryConfig account is not initialized");
        return Err(ProgramError::UninitializedAccount);
    }

    let config: TreasuryConfig = read_account_data(
        &accounts.treasury_config.try_borrow_data()?,
        TreasuryConfig::account_type(),
    )?;
    let lock_duration_days: u16 = config.checker_rewards_lock_days;

    grant_locked(
        program_id,
        accounts.signer, // payer
        accounts.treasury_state,
        accounts.treasury_ata,
        accounts.locked_tokens,
        accounts.system_program,
        &input.license_context.owner,
        payout_amount,
        lock_duration_days,
    )?;

    Ok(())
}

fn reset_checker_balance(global_rewards_account: &AccountInfo, checker_index: usize) -> ProgramResult {
    let mut global_rewards_data = global_rewards_account.try_borrow_mut_data()?;
    GlobalRewards::reset_checker_balance(&mut global_rewards_data, checker_index)?;
    Ok(())
}

fn validate_checker_metadata_and_authorization(
    program_id: &Pubkey,
    checker_metadata_account: &AccountInfo,
    signer_account: &AccountInfo,
    leaf_asset_id: &Pubkey,
    license_owner: &Pubkey,
) -> ProgramResult {
    // Calculate expected CheckerMetadata PDA
    let (checker_metadata_pda, _) =
        CheckerMetadata::find_pda(program_id, leaf_asset_id, license_owner);

    // Validate CheckerMetadata PDA
    if *checker_metadata_account.key != checker_metadata_pda {
        msg!("Error: CheckerMetadata account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Check if CheckerMetadata exists
    if checker_metadata_account.data_is_empty() {
        msg!("Error: CheckerMetadata account does not exist. Checker must be activated first");
        return Err(ProgramError::UninitializedAccount);
    }

    // Read CheckerMetadata to check delegation
    let checker_metadata: CheckerMetadata = read_account_data(
        &checker_metadata_account.try_borrow_data()?,
        CheckerMetadata::account_type(),
    )?;

    // Check that the signer is authorized to payout rewards for this checker
    // Allow both the license owner and the delegate to payout rewards
    if *signer_account.key != checker_metadata.delegated_to && *signer_account.key != *license_owner {
        msg!("Error: Transaction signer is not authorized to payout rewards for this checker");
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}

fn validate_checker_license_metadata(
    program_id: &Pubkey,
    checker_license_metadata_account: &AccountInfo,
    leaf_asset_id: &Pubkey
) -> ProgramResult {
    // Calculate expected CheckerLicenseMetadata PDA
    let (checker_license_metadata_pda, _) =
        CheckerLicenseMetadata::find_pda(program_id, leaf_asset_id);

    // Validate CheckerLicenseMetadata PDA
    if *checker_license_metadata_account.key != checker_license_metadata_pda {
        msg!("Error: CheckerLicenseMetadata account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Check if CheckerLicenseMetadata exists
    if !checker_license_metadata_account.data_is_empty() {
        let checker_license_metadata: CheckerLicenseMetadata = read_account_data(
            &checker_license_metadata_account.try_borrow_data()?,
            CheckerLicenseMetadata::account_type(),
        )?;

        if checker_license_metadata.suspended_at.is_some() {
            msg!("Error: CheckerLicense is suspended");
            return Err(ProgramError::InvalidAccountData);
        }
    }
    Ok(())
}
