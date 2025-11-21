use depin_core::constants::BMB_MULTIPLIER;
use depin_core::utils::validation::validate_pda_account;
use solana_program::{account_info::AccountInfo, msg, program_error::ProgramError, pubkey::Pubkey};

// Sub-modules
pub mod points;
pub mod treasury;
pub mod weighting;

// Re-export commonly used items
pub use points::calculate_points;
pub use treasury::transfer_from_treasury;
pub use weighting::{
    apply_addon_point_weight, apply_base_stake_weight, calculate_time_weighted,
    compute_month_weight_totals, MonthWeightTotals,
};

/// Seeds for token vault PDAs
pub const WORKER_STAKE_VAULT_SEED: &[u8] = b"worker_stake_vault";
pub const COMMUNITY_STAKE_VAULT_SEED: &[u8] = b"community_stake_vault";
pub const TREASURY_SEED: &[u8] = b"treasury";

/// Maximum basis points (100%)
pub const MAX_BASIS_POINTS: u16 = 10_000;

// Metaplex Core collection account layout constants
/// Size of the discriminator/key field in collection account
const COLLECTION_KEY_SIZE: usize = 1;
/// Size of a Pubkey (update_authority field)
const PUBKEY_SIZE: usize = 32;
/// Minimum data length required to read update_authority (key + pubkey)
const COLLECTION_MIN_DATA_LEN: usize = COLLECTION_KEY_SIZE + PUBKEY_SIZE;

/// BMB tokens required per checker point (for addon pool eligibility)
/// Points = min(checker_count, floor(staked_bmb / BMB_PER_POINT))
/// This is 2500 BMB in base units
pub const BMB_PER_POINT: u64 = 2_500 * BMB_MULTIPLIER;

/// Find worker stake vault PDA (the authority/owner of the token account)
pub fn find_worker_stake_vault_pda(
    program_id: &Pubkey,
    worker_collection: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[WORKER_STAKE_VAULT_SEED, worker_collection.as_ref()],
        program_id,
    )
}

/// Find worker stake vault ATA (the actual token account)
pub fn find_worker_stake_vault_ata(
    program_id: &Pubkey,
    worker_collection: &Pubkey,
    mint: &Pubkey,
) -> Pubkey {
    let (vault_pda, _) = find_worker_stake_vault_pda(program_id, worker_collection);
    spl_associated_token_account::get_associated_token_address(&vault_pda, mint)
}

/// Find community stake vault PDA (the authority/owner of the token account)
pub fn find_community_stake_vault_pda(
    program_id: &Pubkey,
    worker_collection: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[COMMUNITY_STAKE_VAULT_SEED, worker_collection.as_ref()],
        program_id,
    )
}

/// Find community stake vault ATA (the actual token account)
pub fn find_community_stake_vault_ata(
    program_id: &Pubkey,
    worker_collection: &Pubkey,
    mint: &Pubkey,
) -> Pubkey {
    let (vault_pda, _) = find_community_stake_vault_pda(program_id, worker_collection);
    spl_associated_token_account::get_associated_token_address(&vault_pda, mint)
}

/// Find treasury PDA (the authority/owner of the token account)
pub fn find_treasury_pda(program_id: &Pubkey, worker_collection: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[TREASURY_SEED, worker_collection.as_ref()], program_id)
}

/// Validates that the signer is the collection's update authority
///
/// # Arguments
/// * `worker_collection_account` - The Metaplex Core collection account
/// * `expected_authority` - The account that should match the collection's update authority
///
/// # Returns
/// * `Ok(())` if validation passes
/// * `Err(ProgramError)` if validation fails
pub fn validate_collection_authority<'a>(
    worker_collection_account: &AccountInfo<'a>,
    expected_authority: &AccountInfo<'a>,
) -> Result<(), ProgramError> {
    // Validate signer
    if !expected_authority.is_signer {
        msg!("Error: Collection authority must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Read update_authority directly from bytes
    // Collection layout: key (1 byte) + update_authority (32 bytes) + ...
    let data = worker_collection_account.try_borrow_data()?;
    if data.len() < COLLECTION_MIN_DATA_LEN {
        msg!("Error: Collection account data too short");
        return Err(ProgramError::InvalidAccountData);
    }

    let update_authority =
        Pubkey::try_from(&data[COLLECTION_KEY_SIZE..COLLECTION_MIN_DATA_LEN])
            .map_err(|_| ProgramError::InvalidAccountData)?;

    if &update_authority != expected_authority.key {
        msg!("Error: Collection authority does not match signer");
        return Err(ProgramError::InvalidArgument);
    }

    Ok(())
}

/// Initializes a monthly pool with inheritance from the previous active pool
///
/// This function implements the pool initialization and inheritance logic described in the TDD.
/// On first activity (stake or revenue deposit), inheritance runs to carry over stake and points
/// from the previous active pool, excluding opted-out positions.
///
/// # Arguments
/// * `program_id` - The program ID
/// * `worker_collection` - The worker collection pubkey
/// * `current_month_period` - The current month period being initialized
/// * `monthly_pool` - The monthly pool to initialize (mutable)
/// * `config` - The worker stake config (mutable, will update last_active_pool_month)
/// * `prev_pool_account` - Optional previous pool account (required if last_active_pool_month > 0)
///
/// # Returns
/// * `Ok(())` if initialization succeeds
/// * `Err(ProgramError)` if validation fails
pub fn initialize_pool_with_inheritance<'a>(
    program_id: &Pubkey,
    worker_collection: &Pubkey,
    current_month_period: u16,
    monthly_pool: &mut crate::state::MonthlyPool,
    config: &mut crate::state::WorkerStakeConfig,
    prev_pool_account: Option<&AccountInfo<'a>>,
) -> Result<(), ProgramError> {
    use crate::{state::MonthlyPool, types::WorkerStakeAccountType};
    use depin_core::utils::account::read_account_data;
    use depin_core::utils::bmb::days_in_month;

    // Check if already initialized
    if monthly_pool.initialized {
        return Ok(());
    }

    // If there's a previous active pool, inherit from it
    if config.last_active_pool_month > 0 {
        // Previous pool account must be provided
        let prev_pool_acc = prev_pool_account.ok_or_else(|| {
            msg!("Error: Previous pool account required for inheritance");
            ProgramError::NotEnoughAccountKeys
        })?;

        // Validate previous pool PDA
        let (expected_prev_pda, _bump) =
            MonthlyPool::find_pda(program_id, worker_collection, config.last_active_pool_month);
        validate_pda_account(prev_pool_acc, &expected_prev_pda, "Previous MonthlyPool")?;

        // Load previous pool
        let prev_pool_data = prev_pool_acc.try_borrow_data()?;
        let prev_pool: MonthlyPool =
            read_account_data(&prev_pool_data, WorkerStakeAccountType::MonthlyPool)?;
        drop(prev_pool_data);

        // Inherit base pool stake (excluding opted-out positions)
        // Inherited stake gets full month weight (staked before month started)
        monthly_pool.base_pool.total = prev_pool
            .base_pool
            .total
            .checked_sub(prev_pool.base_pool.total_opted_out)
            .ok_or_else(|| {
                msg!("Error: Arithmetic overflow in base pool inheritance");
                ProgramError::ArithmeticOverflow
            })?;

        // Calculate weighted total: inherited_stake × days_in_month
        let days = days_in_month(current_month_period) as u64;
        monthly_pool.base_pool.total_weighted =
            calculate_time_weighted(monthly_pool.base_pool.total, days)?;

        // Inherit addon pool points (excluding opted-out points)
        // Inherited points get full month weight (qualified before month started)
        monthly_pool.addon_pool.total = prev_pool
            .addon_pool
            .total
            .checked_sub(prev_pool.addon_pool.total_opted_out)
            .ok_or_else(|| {
                msg!("Error: Arithmetic overflow in addon pool inheritance");
                ProgramError::ArithmeticOverflow
            })?;

        // Calculate weighted total: inherited_points × days_in_month (reuse days from above)
        monthly_pool.addon_pool.total_weighted =
            calculate_time_weighted(monthly_pool.addon_pool.total, days)?;

        msg!(
            "Inherited from month {}: base_total={}, addon_total={}",
            config.last_active_pool_month,
            monthly_pool.base_pool.total,
            monthly_pool.addon_pool.total
        );
    }

    // Mark pool as initialized
    monthly_pool.initialized = true;

    // Update last active pool month
    config.last_active_pool_month = current_month_period;

    msg!("Pool initialized for month {}", current_month_period);
    Ok(())
}
