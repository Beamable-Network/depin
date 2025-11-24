use solana_program::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    program::invoke_signed,
    system_instruction,
    sysvar::{rent::Rent, Sysvar},
    msg,
};
use spl_token::{
    instruction as token_instruction,
    solana_program::program_pack::Pack,
    state::Account as TokenAccount,
};
use spl_associated_token_account::get_associated_token_address;

use crate::shared::{
    constants::seeds::{TREASURY_SEED, LOCK_SEED},
    features::treasury::accounts::{TreasuryState, TreasuryAuthority, LockedTokens},
};
use depin_core::{
    constants::BMB_MINT,
    utils::{
        account::{read_account_data, write_account_data, close_account},
        bmb::get_current_period
    }
};

/// Creates or adds to locked tokens for a user with period-based accumulation
pub fn grant_locked<'a>(
    program_id: &Pubkey,
    payer_account: &AccountInfo<'a>,
    treasury_state_account: &AccountInfo<'a>,
    treasury_ata_account: &AccountInfo<'a>,
    locked_tokens_account: &AccountInfo<'a>,
    system_program: &AccountInfo<'a>,
    owner: &Pubkey,
    amount: u64,
    lock_duration_days: u16,  // Duration in days (e.g., 365 for 12 months)
) -> Result<(), ProgramError> {
    // Get current period and calculate unlock period
    let current_period = get_current_period();
    let unlock_period = current_period + lock_duration_days;

    // Calculate expected locked tokens PDA using current and unlock period
    let (locked_tokens_pda, bump_seed) = LockedTokens::find_pda(program_id, owner, current_period, unlock_period);

    if *locked_tokens_account.key != locked_tokens_pda {
        msg!("Error: LockedTokens account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate treasury state account
    let (treasury_state_pda, _) = TreasuryState::find_pda(program_id);
    if *treasury_state_account.key != treasury_state_pda {
        msg!("Error: TreasuryState account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate treasury ATA account
    let (treasury_authority_pda, _) = TreasuryAuthority::find_pda(program_id);
    let expected_treasury_ata = get_associated_token_address(&treasury_authority_pda, &BMB_MINT);
    if *treasury_ata_account.key != expected_treasury_ata {
        msg!("Error: Treasury ATA account does not match expected address. Expected: {}, Provided: {}", 
            expected_treasury_ata, treasury_ata_account.key);
        return Err(ProgramError::InvalidArgument);
    }

    // Check that treasury ATA account exists and is initialized
    if treasury_ata_account.data_is_empty() {
        msg!("Error: Treasury ATA account does not exist. Please initialize the treasury ATA account first.");
        return Err(ProgramError::UninitializedAccount);
    }

    // Check treasury has sufficient available balance
    let treasury_account = TokenAccount::unpack(&treasury_ata_account.try_borrow_data()?)?;
    let mut treasury_state: TreasuryState = read_account_data(
        &treasury_state_account.try_borrow_data()?,
        TreasuryState::account_type(),
    )?;

    let available_balance = treasury_account.amount.saturating_sub(treasury_state.locked_balance);
    if available_balance < amount {
        msg!("Error: Insufficient available treasury balance. Available: {}, Required: {}", 
            available_balance, amount);
        return Err(ProgramError::InsufficientFunds);
    }

    // Check if locked tokens account already exists (accumulation pattern)
    if locked_tokens_account.data_is_empty() {
        // Create new LockedTokens account
        let rent = Rent::get()?;
        let space = LockedTokens::LEN;
        let rent_lamports = rent.minimum_balance(space);

        invoke_signed(
            &system_instruction::create_account(
                payer_account.key,
                &locked_tokens_pda,
                rent_lamports,
                space as u64,
                program_id,
            ),
            &[
                payer_account.clone(),
                locked_tokens_account.clone(),
                system_program.clone(),
            ],
            &[&[
                TREASURY_SEED,
                LOCK_SEED,
                owner.as_ref(),
                &current_period.to_le_bytes(),
                &unlock_period.to_le_bytes(),
                &[bump_seed],
            ]],
        )?;

        // Initialize locked tokens data
        let locked_tokens_data = LockedTokens::new(*owner, amount, current_period, unlock_period);
        let mut locked_data = locked_tokens_account.try_borrow_mut_data()?;
        write_account_data(&mut locked_data, LockedTokens::account_type(), &locked_tokens_data)?;

        msg!("Created new LockedTokens account with {} BMB", amount);
    } else {
        // Add to existing locked tokens (accumulation) after schedule validation
        let mut locked_tokens: LockedTokens = read_account_data(
            &locked_tokens_account.try_borrow_data()?,
            LockedTokens::account_type(),
        )?;

        // Verify the account belongs to the correct owner
        if locked_tokens.owner != *owner {
            msg!("Error: LockedTokens account owner mismatch");
            return Err(ProgramError::InvalidAccountData);
        }

        // Ensure schedule matches the PDA we expect
        if locked_tokens.lock_period != current_period || locked_tokens.unlock_period != unlock_period {
            msg!("Error: LockedTokens schedule mismatch");
            return Err(ProgramError::InvalidAccountData);
        }

        // Add tokens to existing account
        locked_tokens.add_tokens(amount);
        let mut locked_data = locked_tokens_account.try_borrow_mut_data()?;
        write_account_data(&mut locked_data, LockedTokens::account_type(), &locked_tokens)?;

        msg!("Added {} BMB to existing LockedTokens account, total now: {}", amount, locked_tokens.total_locked);
    }

    // Update treasury state to reflect locked commitment
    treasury_state.add_locked_balance(amount);
    let mut treasury_state_data = treasury_state_account.try_borrow_mut_data()?;
    write_account_data(&mut treasury_state_data, TreasuryState::account_type(), &treasury_state)?;

    msg!("Successfully created locked tokens: {} BMB locked until period {}", amount, unlock_period);
    Ok(())
}

/// Calculate vested amount based on linear vesting.
/// Vests linearly from 0% at `lock_period` to 100% at `unlock_period`.
/// Returns the **total vested so far** (not the delta for this period).
pub fn calculate_vested_amount(
    total_locked: u64,
    lock_period: u16,
    current_period: u16,
    unlock_period: u16,
) -> u64 {
    // Duration of the vesting window
    let dur = unlock_period.saturating_sub(lock_period);
    if dur == 0 {
        // By convention: fully vested if no window (unlock <= lock).
        return total_locked;
    }

    // Elapsed time since lock, clamped to [0, dur]
    let elapsed = current_period.saturating_sub(lock_period).min(dur);

    // Use u128 for intermediate math to avoid u64 overflow.
    let num = (total_locked as u128) * (elapsed as u128);
    let den = dur as u128;

    let vested = num / den;

    // Defensive clamp back to total_locked
    vested.min(total_locked as u128) as u64
}

/// Unlocks tokens with dynamic penalty calculation
pub fn unlock<'a>(
    program_id: &Pubkey,
    signer_account: &AccountInfo<'a>,
    treasury_state_account: &AccountInfo<'a>,
    treasury_ata_account: &AccountInfo<'a>,
    treasury_authority_account: &AccountInfo<'a>,
    locked_tokens_account: &AccountInfo<'a>,
    owner_token_account: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
) -> Result<(), ProgramError> {    
    // Validate locked tokens account
    if locked_tokens_account.data_is_empty() {
        msg!("Error: LockedTokens account does not exist");
        return Err(ProgramError::UninitializedAccount);
    }

    let locked_tokens: LockedTokens = read_account_data(
        &locked_tokens_account.try_borrow_data()?,
        LockedTokens::account_type(),
    )?;

    // Check signer authorization
    if *signer_account.key != locked_tokens.owner {
        msg!("Error: Only the owner can unlock tokens");
        return Err(ProgramError::MissingRequiredSignature);
    }

    if !signer_account.is_signer {
        msg!("Error: Owner must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Get current period and calculate vested amount
    let current_period = get_current_period();

    if locked_tokens.lock_period >= current_period {
        msg!("Error: Tokens can be unlocked next day after locking. Current period: {}, Lock period: {}",
            current_period, locked_tokens.lock_period);
        return Err(ProgramError::InvalidArgument);
    }

    let payout_amount = calculate_vested_amount(
        locked_tokens.total_locked,
        locked_tokens.lock_period,
        current_period,
        locked_tokens.unlock_period
    );
    let penalty_amount = locked_tokens.total_locked - payout_amount;
    
    // Validate treasury accounts
    let (treasury_state_pda, _) = TreasuryState::find_pda(program_id);
    if *treasury_state_account.key != treasury_state_pda {
        msg!("Error: TreasuryState account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate treasury authority account
    let (treasury_authority_pda, treasury_authority_bump) = TreasuryAuthority::find_pda(program_id);
    if *treasury_authority_account.key != treasury_authority_pda {
        msg!("Error: Treasury authority account does not match expected PDA. Expected: {}, Provided: {}", 
            treasury_authority_pda, treasury_authority_account.key);
        return Err(ProgramError::InvalidArgument);
    }

    // Validate treasury ATA account
    let expected_treasury_ata = get_associated_token_address(&treasury_authority_pda, &BMB_MINT);
    if *treasury_ata_account.key != expected_treasury_ata {
        msg!("Error: Treasury ATA account does not match expected address. Expected: {}, Provided: {}", 
            expected_treasury_ata, treasury_ata_account.key);
        return Err(ProgramError::InvalidArgument);
    }

    // Validate owner token account
    let owner_token_state = TokenAccount::unpack(&owner_token_account.try_borrow_data()?)?;
    if owner_token_state.mint != BMB_MINT {
        msg!("Error: Owner token account is not for BMB mint");
        return Err(ProgramError::InvalidAccountData);
    }

    if owner_token_state.owner != locked_tokens.owner {
        msg!("Error: Token account is not owned by the lock owner");
        return Err(ProgramError::InvalidAccountData);
    }

    // Transfer tokens from treasury ATA to owner (minus penalty)
    invoke_signed(
        &token_instruction::transfer(
            &token_program.key,
            &treasury_ata_account.key,
            &owner_token_account.key,
            &treasury_authority_pda,
            &[],
            payout_amount,
        )?,
        &[
            treasury_ata_account.clone(),
            owner_token_account.clone(),
            treasury_authority_account.clone(),
            token_program.clone(),
        ],
        &[&[
            TREASURY_SEED,
            &[treasury_authority_bump],
        ]],
    )?;

    // Update treasury state to reduce locked balance
    let mut treasury_state: TreasuryState = read_account_data(
        &treasury_state_account.try_borrow_data()?,
        TreasuryState::account_type(),
    )?;
    treasury_state.subtract_locked_balance(locked_tokens.total_locked);
    let mut treasury_state_data = treasury_state_account.try_borrow_mut_data()?;
    write_account_data(&mut treasury_state_data, TreasuryState::account_type(), &treasury_state)?;

    // Close the locked tokens account and return rent to the user
    let rent_lamports = close_account(locked_tokens_account, signer_account)?;

    msg!("Successfully unlocked {} BMB tokens (penalty: {} BMB retained in treasury, {} lamports rent returned)",
        payout_amount, penalty_amount, rent_lamports);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_vested_amount_all_durations() {
        let total_locked = 10_000u64;
        let lock_period = 100u16;
        let unlock_period = 190u16;
        let duration = (unlock_period - lock_period) as u64; // 90 days

        println!("\nTesting linear vesting for {} tokens over {} days:", total_locked, duration);
        println!("Day | Current Period | Elapsed | Vested Amount | Penalty | % Vested");
        println!("----+----------------+---------+---------------+---------+---------");

        // Test from day 0 to day 110 (beyond unlock period)
        for day in 0..=110 {
            let current_period = lock_period + day;
            let vested = calculate_vested_amount(total_locked, lock_period, current_period, unlock_period);
            let penalty = total_locked - vested;
            let elapsed = if current_period <= lock_period {
                0
            } else {
                (current_period - lock_period).min(unlock_period - lock_period)
            };
            let percent_vested = (vested as f64 / total_locked as f64) * 100.0;

            println!("{:3} | {:14} | {:7} | {:13} | {:7} | {:6.2}%",
                day, current_period, elapsed, vested, penalty, percent_vested);

            // Verify invariants
            assert_eq!(vested + penalty, total_locked, "Day {}: vested + penalty must equal total_locked", day);

            // At day 0, vested should be 0
            if day == 0 {
                assert_eq!(vested, 0, "Day 0: no vesting should occur");
            }

            // At unlock period or beyond, should be fully vested
            if current_period >= unlock_period {
                assert_eq!(vested, total_locked, "Day {}: should be fully vested at or after unlock period", day);
            }

            // Vesting should be monotonically increasing
            if day > 0 && current_period <= unlock_period {
                let prev_period = lock_period + day - 1;
                let prev_vested = calculate_vested_amount(total_locked, lock_period, prev_period, unlock_period);
                assert!(vested >= prev_vested, "Day {}: vesting should be monotonically increasing", day);
            }
        }
    }
}
