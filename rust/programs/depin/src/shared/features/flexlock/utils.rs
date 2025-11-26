use solana_program::{
    account_info::AccountInfo,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    system_instruction,
    sysvar::{rent::Rent, Sysvar},
};
use spl_token::instruction::transfer_checked;

use crate::shared::{
    constants::seeds::{FLEXLOCK_SEED, LOCK_SEED, VAULT_SEED},
    features::flexlock::accounts::{FlexlockTokens, FlexlockVault},
};
use depin_core::{
    constants::BMB_MINT,
    utils::{
        account::{close_account, read_account_data, write_account_data},
        bmb::get_current_period,
        validation::{validate_ata_account, validate_pda_account},
    },
};

/// Sends tokens using flexlock to a specified receiver
/// 
/// Supports both regular wallet senders and PDA senders:
/// - For wallet senders: pass None for sender_pda_seeds
/// - For PDA senders: pass Some(&[seeds]) for sender_pda_seeds
pub fn lock<'a>(
    program_id: &Pubkey,
    payer_account: &AccountInfo<'a>, // Account that pays for account creation (must be signer)
    receiver: &Pubkey,
    amount: u64,
    lock_duration_days: u16, // Duration in days (e.g., 365 for 12 months)
    rent_receiver: &Pubkey, // Address that will receive rent when the account is closed
    sender_account: &AccountInfo<'a>,
    sender_ata_account: &AccountInfo<'a>,
    flexlock_tokens_account: &AccountInfo<'a>,
    flexlock_vault_ata_account: &AccountInfo<'a>,
    bmb_mint_account: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    system_program: &AccountInfo<'a>,
    sender_pda_seeds: Option<&[&[u8]]>, // Seeds for PDA signing (None for regular wallet senders)
) -> Result<(), ProgramError> {
    // Validate signer - either sender is signer (wallet) or PDA seeds provided
    if sender_pda_seeds.is_none() && !sender_account.is_signer {
        msg!("Error: Sender account must be a signer when not using PDA");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate payer is signer
    if !payer_account.is_signer {
        msg!("Error: Payer account must be a signer");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate amount
    if amount == 0 {
        msg!("Error: Amount must be greater than 0");
        return Err(ProgramError::InvalidArgument);
    }

    // Get current period and calculate unlock period
    let current_period = get_current_period();
    let unlock_period = current_period.checked_add(lock_duration_days)
      .ok_or_else(|| {
          msg!("Error: Lock duration would cause period overflow");
          ProgramError::InvalidArgument
      })?;

    // Validate lock duration
    if (current_period == unlock_period) || (unlock_period < current_period) {
        msg!("Error: Invalid lock duration specified");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate BMB mint account
    if bmb_mint_account.key != &BMB_MINT {
        msg!("Error: Invalid BMB mint account");
        return Err(ProgramError::InvalidAccountData);
    }

    // Validate flexlock tokens PDA account
    let (flexlock_tokens_pda, bump_seed) = FlexlockTokens::find_pda(
        program_id,
        sender_account.key,
        receiver,
        current_period,
        unlock_period,
    );
    validate_pda_account(
        flexlock_tokens_account,
        &flexlock_tokens_pda,
        "Flexlock Tokens Account",
    )?;

    // Validate vault ATA account
    let (vault_authority_pda, _) = FlexlockVault::find_pda(program_id);
    validate_ata_account(
        flexlock_vault_ata_account,
        &vault_authority_pda,
        &BMB_MINT,
        "Vault BMB",
    )?;

    // Validate sender ATA account
    validate_ata_account(
        sender_ata_account,
        sender_account.key,
        &BMB_MINT,
        "Sender BMB",
    )?;

    // Check that vault ATA account exists and is initialized
    if flexlock_vault_ata_account.data_is_empty() {
        msg!("Error: Vault ATA account does not exist. Please initialize the vault ATA account first.");
        return Err(ProgramError::UninitializedAccount);
    }

    // Transfer BMB from sender to flexlock vault
    let transfer_ix = transfer_checked(
        token_program.key,
        sender_ata_account.key,
        bmb_mint_account.key,
        flexlock_vault_ata_account.key,
        sender_account.key,
        &[],
        amount,
        depin_core::constants::BMB_DECIMALS,
    )?;

    // Invoke the transfer (use invoke_signed if sender is PDA)
    if let Some(seeds) = sender_pda_seeds {
        invoke_signed(
            &transfer_ix,
            &[
                sender_ata_account.clone(),
                bmb_mint_account.clone(),
                flexlock_vault_ata_account.clone(),
                sender_account.clone(),
                token_program.clone(),
            ],
            &[seeds],
        )?;
    } else {
        invoke(
            &transfer_ix,
            &[
                sender_ata_account.clone(),
                bmb_mint_account.clone(),
                flexlock_vault_ata_account.clone(),
                sender_account.clone(),
                token_program.clone(),
            ],
        )?;
    }    

    // Check if flexlock tokens account already exists (accumulation pattern)
    if flexlock_tokens_account.data_is_empty() {
        // Create new flexlock tokens account
        let rent = Rent::get()?;
        let space = FlexlockTokens::LEN;
        let rent_lamports = rent.minimum_balance(space);

        invoke_signed(
            &system_instruction::create_account(
                payer_account.key,
                &flexlock_tokens_pda,
                rent_lamports,
                space as u64,
                program_id,
            ),
            &[
                payer_account.clone(),
                flexlock_tokens_account.clone(),
                system_program.clone(),
            ],
            &[&[
                FLEXLOCK_SEED,
                LOCK_SEED,
                sender_account.key.as_ref(),
                receiver.as_ref(),
                &current_period.to_le_bytes(),
                &unlock_period.to_le_bytes(),
                &[bump_seed],
            ]],
        )?;

        msg!("Created new FlexlockTokens account with {} BMB for receiver {}", amount, receiver);

        // Initialize flexlock tokens data
        let flexlocked_tokens_data = FlexlockTokens::new(
            *sender_account.key,
            *receiver,
            amount,
            current_period,
            unlock_period,
            *rent_receiver,
        );
        let mut flexlock_data = flexlock_tokens_account.try_borrow_mut_data()?;
        write_account_data(
            &mut flexlock_data,
            FlexlockTokens::account_type(),
            &flexlocked_tokens_data,
        )?;
    } else {
        // Add to existing flexlock tokens (accumulation) after schedule validation
        let mut flexlock_tokens: FlexlockTokens = read_account_data(
            &flexlock_tokens_account.try_borrow_data()?,
            FlexlockTokens::account_type(),
        )?;

        // Verify the account belongs to the correct owner
        if flexlock_tokens.receiver != *receiver {
            msg!("Error: FlexlockTokens account owner mismatch");
            return Err(ProgramError::InvalidAccountData);
        }

        // Verify the account belongs to the correct owner
        if flexlock_tokens.sender != *sender_account.key {
            msg!("Error: FlexlockTokens account sender mismatch");
            return Err(ProgramError::InvalidAccountData);
        }

        // Ensure schedule matches the PDA we expect
        if flexlock_tokens.lock_period != current_period
            || flexlock_tokens.unlock_period != unlock_period
        {
            msg!("Error: FlexlockTokens schedule mismatch");
            return Err(ProgramError::InvalidAccountData);
        }

        // Add tokens to existing account
        flexlock_tokens.add_tokens(amount);
        let mut flexlock_data = flexlock_tokens_account.try_borrow_mut_data()?;
        write_account_data(
            &mut flexlock_data,
            FlexlockTokens::account_type(),
            &flexlock_tokens,
        )?;

        msg!(
            "Added {} to existing FlexlockTokens account, new amount: {}",
            amount,
            flexlock_tokens.amount
        );
    }

    msg!(
        "Successfully created flexlock tokens: {} locked until period {}",
        amount,
        unlock_period
    );
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

/// Unlocks flexlock tokens with dynamic penalty calculation
/// Vested amount goes to receiver, penalty goes back to sender
pub fn unlock<'a>(
    program_id: &Pubkey,
    receiver_account: &AccountInfo<'a>,
    sender_account: &AccountInfo<'a>,
    flexlock_tokens_account: &AccountInfo<'a>,
    flexlock_vault_ata_account: &AccountInfo<'a>,
    flexlock_vault_authority_account: &AccountInfo<'a>,
    receiver_ata_account: &AccountInfo<'a>,
    sender_ata_account: &AccountInfo<'a>,
    bmb_mint_account: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    rent_receiver_account: &AccountInfo<'a>,
) -> Result<(), ProgramError> {
    // Validate flexlock tokens account exists
    if flexlock_tokens_account.data_is_empty() {
        msg!("Error: FlexlockTokens account does not exist");
        return Err(ProgramError::UninitializedAccount);
    }

    // Read flexlock tokens data
    let flexlock_tokens: FlexlockTokens = read_account_data(
        &flexlock_tokens_account.try_borrow_data()?,
        FlexlockTokens::account_type(),
    )?;

    // Validate receiver authorization - only receiver can unlock
    if *receiver_account.key != flexlock_tokens.receiver {
        msg!("Error: Only the receiver can unlock tokens");
        return Err(ProgramError::MissingRequiredSignature);
    }

    if !receiver_account.is_signer {
        msg!("Error: Receiver must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate sender account matches
    if *sender_account.key != flexlock_tokens.sender {
        msg!("Error: Sender account does not match FlexlockTokens sender");
        return Err(ProgramError::InvalidAccountData);
    }

    // Validate PDA derivation
    let (expected_flexlock_tokens_pda, _) = FlexlockTokens::find_pda(
        program_id,
        &flexlock_tokens.sender,
        &flexlock_tokens.receiver,
        flexlock_tokens.lock_period,
        flexlock_tokens.unlock_period,
    );
    validate_pda_account(flexlock_tokens_account, &expected_flexlock_tokens_pda, "Flexlock Tokens")?;

    // Validate BMB mint account
    if bmb_mint_account.key != &BMB_MINT {
        msg!("Error: Invalid BMB mint account");
        return Err(ProgramError::InvalidAccountData);
    }

    // Validate vault authority account
    let (vault_authority_pda, vault_authority_bump) = FlexlockVault::find_pda(program_id);
    validate_pda_account(flexlock_vault_authority_account, &vault_authority_pda, "Flexlock Vault Authority")?;    

    // Validate vault ATA account
    validate_ata_account(
        flexlock_vault_ata_account,
        &vault_authority_pda,
        &BMB_MINT,
        "Vault BMB",
    )?;

    // Validate receiver token account
    validate_ata_account(
        receiver_ata_account,
        &flexlock_tokens.receiver,
        &BMB_MINT,
        "Receiver BMB",
    )?;

    // Validate sender token account
    validate_ata_account(
        sender_ata_account,
        &flexlock_tokens.sender,
        &BMB_MINT,
        "Sender BMB",
    )?;

    // Get current period and calculate vested amount
    let current_period = get_current_period();

    if flexlock_tokens.lock_period >= current_period {
        msg!(
            "Error: Tokens can be unlocked next day after locking. Current period: {}, Lock period: {}",
            current_period,
            flexlock_tokens.lock_period
        );
        return Err(ProgramError::InvalidArgument);
    }

    let vested_amount = calculate_vested_amount(
        flexlock_tokens.amount,
        flexlock_tokens.lock_period,
        current_period,
        flexlock_tokens.unlock_period,
    );
    let penalty_amount = flexlock_tokens.amount - vested_amount;

    // Transfer vested amount from vault to receiver
    if vested_amount > 0 {
        let transfer_to_receiver_ix = transfer_checked(
            token_program.key,
            flexlock_vault_ata_account.key,
            bmb_mint_account.key,
            receiver_ata_account.key,
            &vault_authority_pda,
            &[],
            vested_amount,
            depin_core::constants::BMB_DECIMALS,
        )?;

        invoke_signed(
            &transfer_to_receiver_ix,
            &[
                flexlock_vault_ata_account.clone(),
                bmb_mint_account.clone(),
                receiver_ata_account.clone(),
                flexlock_vault_authority_account.clone(),
                token_program.clone(),
            ],
            &[&[VAULT_SEED, FLEXLOCK_SEED, &[vault_authority_bump]]],
        )?;
    }

    // Transfer penalty amount back to sender
    if penalty_amount > 0 {
        let transfer_to_sender_ix = transfer_checked(
            token_program.key,
            flexlock_vault_ata_account.key,
            bmb_mint_account.key,
            sender_ata_account.key,
            &vault_authority_pda,
            &[],
            penalty_amount,
            depin_core::constants::BMB_DECIMALS,
        )?;

        invoke_signed(
            &transfer_to_sender_ix,
            &[
                flexlock_vault_ata_account.clone(),
                bmb_mint_account.clone(),
                sender_ata_account.clone(),
                flexlock_vault_authority_account.clone(),
                token_program.clone(),
            ],
            &[&[VAULT_SEED, FLEXLOCK_SEED, &[vault_authority_bump]]],
        )?;
    }

    // Close the flexlock tokens account and return rent to the specified rent_receiver
    // Validate that the provided rent_receiver_account matches the one stored in FlexlockTokens
    if *rent_receiver_account.key != flexlock_tokens.rent_receiver {
        msg!(
            "Error: Provided rent receiver {} does not match expected rent receiver {}",
            rent_receiver_account.key,
            flexlock_tokens.rent_receiver
        );
        return Err(ProgramError::InvalidAccountData);
    }

    let rent_lamports = close_account(flexlock_tokens_account, rent_receiver_account)?;

    msg!(
        "Successfully unlocked flexlock tokens: {} BMB to receiver, {} BMB penalty returned to sender, {} lamports rent returned to {}",
        vested_amount,
        penalty_amount,
        rent_lamports,
        flexlock_tokens.rent_receiver
    );

    Ok(())
}
