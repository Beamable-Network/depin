use depin_core::constants::BMB_DECIMALS;
use solana_program::{
    account_info::AccountInfo,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

/// Seeds for token vault PDAs
pub const WORKER_STAKE_VAULT_SEED: &[u8] = b"worker_stake_vault";
pub const COMMUNITY_STAKE_VAULT_SEED: &[u8] = b"community_stake_vault";
pub const USDC_TREASURY_SEED: &[u8] = b"usdc_treasury";
pub const BMB_TREASURY_SEED: &[u8] = b"bmb_treasury";

/// Maximum basis points (100%)
pub const MAX_BASIS_POINTS: u16 = 10_000;

/// BMB tokens required per checker point (for addon pool eligibility)
/// Points = min(checker_count, floor(staked_bmb / BMB_PER_POINT))
/// This is 2500 BMB in base units
pub const BMB_PER_POINT: u64 = 2_500 * 10_u64.pow(BMB_DECIMALS as u32);

/// Calculate time-weighted contribution for a given amount and time period
/// Used by both base pool (BMB stake) and addon pool (points)
///
/// # Arguments
/// * `amount` - The amount being weighted (BMB for base pool, points for addon pool)
/// * `days_active` - Number of days the amount was active in the month
///
/// # Returns
/// * Weighted value: amount × days_active (absolute days, not normalized)
///
/// # Examples
/// ```
/// // Stake 1000 BMB for full 30-day month
/// let weighted = calculate_time_weighted(1000, 30); // = 30,000 stake-days
///
/// // Stake 1000 BMB for 15 days (mid-month)
/// let weighted = calculate_time_weighted(1000, 15); // = 15,000 stake-days
/// ```
pub fn calculate_time_weighted(amount: u64, days_active: u64) -> Result<u64, ProgramError> {
    (amount as u128)
        .checked_mul(days_active as u128)
        .and_then(|result| {
            if result > u64::MAX as u128 {
                None
            } else {
                Some(result as u64)
            }
        })
        .ok_or_else(|| {
            msg!("Error: Arithmetic overflow in time-weighted calculation");
            ProgramError::ArithmeticOverflow
        })
}

/// Find worker stake vault PDA (the authority/owner of the token account)
pub fn find_worker_stake_vault_pda(program_id: &Pubkey, worker_collection: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[WORKER_STAKE_VAULT_SEED, worker_collection.as_ref()],
        program_id
    )
}

/// Find worker stake vault ATA (the actual token account)
pub fn find_worker_stake_vault_ata(program_id: &Pubkey, worker_collection: &Pubkey, mint: &Pubkey) -> Pubkey {
    let (vault_pda, _) = find_worker_stake_vault_pda(program_id, worker_collection);
    spl_associated_token_account::get_associated_token_address(&vault_pda, mint)
}

/// Find community stake vault PDA (the authority/owner of the token account)
pub fn find_community_stake_vault_pda(program_id: &Pubkey, worker_collection: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[COMMUNITY_STAKE_VAULT_SEED, worker_collection.as_ref()],
        program_id
    )
}

/// Find community stake vault ATA (the actual token account)
pub fn find_community_stake_vault_ata(program_id: &Pubkey, worker_collection: &Pubkey, mint: &Pubkey) -> Pubkey {
    let (vault_pda, _) = find_community_stake_vault_pda(program_id, worker_collection);
    spl_associated_token_account::get_associated_token_address(&vault_pda, mint)
}

/// Find USDC treasury PDA (the authority/owner of the token account)
pub fn find_usdc_treasury_pda(program_id: &Pubkey, worker_collection: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[USDC_TREASURY_SEED, worker_collection.as_ref()],
        program_id
    )
}

/// Find USDC treasury ATA (the actual token account)
pub fn find_usdc_treasury_ata(program_id: &Pubkey, worker_collection: &Pubkey, usdc_mint: &Pubkey) -> Pubkey {
    let (treasury_pda, _) = find_usdc_treasury_pda(program_id, worker_collection);
    spl_associated_token_account::get_associated_token_address(&treasury_pda, usdc_mint)
}

/// Find BMB treasury PDA (the authority/owner of the token account)
pub fn find_bmb_treasury_pda(program_id: &Pubkey, worker_collection: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[BMB_TREASURY_SEED, worker_collection.as_ref()],
        program_id
    )
}

/// Find BMB treasury ATA (the actual token account)
pub fn find_bmb_treasury_ata(program_id: &Pubkey, worker_collection: &Pubkey, bmb_mint: &Pubkey) -> Pubkey {
    let (treasury_pda, _) = find_bmb_treasury_pda(program_id, worker_collection);
    spl_associated_token_account::get_associated_token_address(&treasury_pda, bmb_mint)
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

    // Read update_authority directly from bytes (offset 1-33)
    // Collection layout: key (1 byte) + update_authority (32 bytes) + ...
    let data = worker_collection_account.try_borrow_data()?;
    if data.len() < 33 {
        msg!("Error: Collection account data too short");
        return Err(ProgramError::InvalidAccountData);
    }

    let update_authority = Pubkey::try_from(&data[1..33])
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
    use depin_core::utils::account::read_account_data;
    use depin_core::utils::bmb::days_in_month;
    use crate::{state::MonthlyPool, types::WorkerStakeAccountType};

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
        let (expected_prev_pda, _bump) = MonthlyPool::find_pda(
            program_id,
            worker_collection,
            config.last_active_pool_month,
        );

        if *prev_pool_acc.key != expected_prev_pda {
            msg!(
                "Error: Previous pool account does not match expected PDA for month {}",
                config.last_active_pool_month
            );
            return Err(ProgramError::InvalidArgument);
        }

        // Load previous pool
        let prev_pool_data = prev_pool_acc.try_borrow_data()?;
        let prev_pool: MonthlyPool = read_account_data(&prev_pool_data, WorkerStakeAccountType::MonthlyPool)?;
        drop(prev_pool_data);

        // Inherit base pool stake (excluding opted-out positions)
        // Inherited stake gets full month weight (staked before month started)
        monthly_pool.base_pool.total = prev_pool.base_pool.total
            .checked_sub(prev_pool.base_pool.total_opted_out)
            .ok_or_else(|| {
                msg!("Error: Arithmetic overflow in base pool inheritance");
                ProgramError::ArithmeticOverflow
            })?;

        // Calculate weighted total: inherited_stake × days_in_month
        let days = days_in_month(current_month_period) as u64;
        monthly_pool.base_pool.total_weighted = calculate_time_weighted(
            monthly_pool.base_pool.total,
            days
        )?;

        // Inherit addon pool points (excluding opted-out points)
        // Inherited points get full month weight (qualified before month started)
        monthly_pool.addon_pool.total = prev_pool.addon_pool.total
            .checked_sub(prev_pool.addon_pool.total_opted_out)
            .ok_or_else(|| {
                msg!("Error: Arithmetic overflow in addon pool inheritance");
                ProgramError::ArithmeticOverflow
            })?;

        // Calculate weighted total: inherited_points × days_in_month (reuse days from above)
        monthly_pool.addon_pool.total_weighted = calculate_time_weighted(
            monthly_pool.addon_pool.total,
            days
        )?;

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
