use solana_program::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    program::invoke_signed,
    system_instruction,
    sysvar::{rent::Rent, Sysvar},
    clock::Clock,
    msg,
};
use spl_token::{
    instruction as token_instruction,
    solana_program::program_pack::Pack,
    state::Account as TokenAccount,
};
use spl_associated_token_account::get_associated_token_address;

use crate::{
    constants::{accounts::BMB_MINT, seeds::{TREASURY_SEED, LOCK_SEED}},
    features::treasury::accounts::{TreasuryState, TreasuryAuthority, LockedTokens},
    utils::{account::{read_account_data, write_account_data}, bmb::get_current_period},
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

        // Check if tokens were already unlocked (should not add to unlocked accounts)
        if locked_tokens.unlocked_at.is_some() {
            msg!("Error: Cannot add tokens to already unlocked account");
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

/// Calculate dynamic penalty rate based on periods elapsed
fn calculate_penalty_rate(lock_period: u16, current_period: u16, unlock_period: u16) -> u16 {
    // Rates are expressed in basis points (bps): 10000 bps = 100%
    const MAX_PENALTY_BPS: u16 = 9000; // 90% (9000 bps) at start

    // Duration of the lock window
    let dur = unlock_period.saturating_sub(lock_period);
    if dur == 0 {
        return 0; // No penalty if duration is zero
    }

    // Remaining time until unlock, clamped to [0, dur]
    let remaining = unlock_period
        .saturating_sub(current_period)
        .min(dur);

    // Linear decay: 90% -> 0% as remaining goes dur -> 0
    let rate = (MAX_PENALTY_BPS as u32) * (remaining as u32) / (dur as u32);
    rate as u16
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
    const DENOMINATOR_BPS: u64 = 10_000; // 100% in basis points
    // Validate locked tokens account
    if locked_tokens_account.data_is_empty() {
        msg!("Error: LockedTokens account does not exist");
        return Err(ProgramError::UninitializedAccount);
    }

    let locked_tokens: LockedTokens = read_account_data(
        &locked_tokens_account.try_borrow_data()?,
        LockedTokens::account_type(),
    )?;

    // Check if tokens were already unlocked
    if locked_tokens.unlocked_at.is_some() {
        msg!("Error: Tokens were already unlocked at timestamp {}", locked_tokens.unlocked_at.unwrap());
        return Err(ProgramError::InvalidAccountData);
    }

    // Check signer authorization
    if *signer_account.key != locked_tokens.owner {
        msg!("Error: Only the owner can unlock tokens");
        return Err(ProgramError::MissingRequiredSignature);
    }

    if !signer_account.is_signer {
        msg!("Error: Owner must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Get current period and calculate penalty
    let current_period = get_current_period();

    let penalty_rate = calculate_penalty_rate(locked_tokens.lock_period, current_period, locked_tokens.unlock_period);
    let penalty_amount = (locked_tokens.total_locked * penalty_rate as u64) / DENOMINATOR_BPS;
    let payout_amount = locked_tokens.total_locked - penalty_amount;
    
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

    // Mark tokens as unlocked
    let clock = Clock::get()?;
    let mut updated_locked_tokens = locked_tokens;
    updated_locked_tokens.unlocked_at = Some(clock.unix_timestamp);
    let mut locked_tokens_data = locked_tokens_account.try_borrow_mut_data()?;
    write_account_data(&mut locked_tokens_data, LockedTokens::account_type(), &updated_locked_tokens)?;

    // Note: Penalty amount stays in treasury, locked tokens account can be closed for rent recovery
    msg!("Successfully unlocked {} BMB tokens (penalty: {} BMB retained in treasury)", 
        payout_amount, penalty_amount);
    
    Ok(())
}
