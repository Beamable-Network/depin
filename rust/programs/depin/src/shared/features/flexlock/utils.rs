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
    constants::seeds::{FLEXLOCK_SEED, LOCK_SEED},
    features::flexlock::accounts::{FlexlockTokens, FlexlockVaultAuthority},
};
use depin_core::{
    constants::BMB_MINT,
    utils::{
        account::{read_account_data, write_account_data},
        bmb::get_current_period,
        validation::{validate_ata_account, validate_pda_account},
    },
};

pub fn send_locked<'a>(
    program_id: &Pubkey,
    receiver: &Pubkey,
    amount: u64,
    lock_duration_days: u16, // Duration in days (e.g., 365 for 12 months)
    sender_account: &AccountInfo<'a>,
    sender_ata_account: &AccountInfo<'a>,
    flexlock_tokens_account: &AccountInfo<'a>,
    flexlock_vault_ata_account: &AccountInfo<'a>,
    bmb_mint_account: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    system_program: &AccountInfo<'a>,
) -> Result<(), ProgramError> {
    // Validate signer
    if sender_account.is_signer == false {
        msg!("Error: Sender account must be a signer");
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
    let (vault_authority_pda, _) = FlexlockVaultAuthority::find_pda(program_id);
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

    // Invoke the transfer
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

    // Check if flexlock tokens account already exists (accumulation pattern)
    if flexlock_tokens_account.data_is_empty() {
        // Create new flexlock tokens account
        let rent = Rent::get()?;
        let space = FlexlockTokens::LEN;
        let rent_lamports = rent.minimum_balance(space);

        invoke_signed(
            &system_instruction::create_account(
                sender_account.key,
                &flexlock_tokens_pda,
                rent_lamports,
                space as u64,
                program_id,
            ),
            &[
                sender_account.clone(),
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
