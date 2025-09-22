use borsh::BorshDeserialize;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    system_instruction,
    sysvar::{rent::Rent, Sysvar},
    program::invoke_signed,
};
use shared::{
    constants::seeds::{GLOBAL_SEED, STATE_SEED},
    features::global::accounts::BMBState,
    types::account::DepinAccountType,
    utils::{account::{read_account_data, write_account_data}, bmb::get_current_period},
};
#[cfg(not(feature = "test"))]
use shared::constants::accounts::BMB_LICENSE_ADMIN;
use crate::input::ActivateCheckersInput;

pub fn process_activate_checker_licenses<'info>(
    program_id: &Pubkey,
    accounts: &'info [AccountInfo<'info>],
    instruction_data: &[u8],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] BMB License Admin
    // 1. [writable] BMBState PDA account (will be created if doesn't exist)
    // 2. [readonly] System program account (for account creation)
    let account_info_iter = &mut accounts.iter();
    let admin_account = next_account_info(account_info_iter)?;
    let bmb_state_account = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    let input = ActivateCheckersInput::try_from_slice(instruction_data)?;

    // Verify admin is signer
    if !admin_account.is_signer {
        msg!("Error: BMB License Admin must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify admin authority (skip in test builds)
    #[cfg(not(feature = "test"))]
    if *admin_account.key != BMB_LICENSE_ADMIN {
        msg!("Error: Only BMB License Admin can update BMB state");
        return Err(ProgramError::InvalidAccountOwner);
    }

    // Validate the PDA
    let (bmb_state_pda, bump_seed) = Pubkey::find_program_address(
        &[GLOBAL_SEED, STATE_SEED],
        program_id,
    );

    if *bmb_state_account.key != bmb_state_pda {
        msg!("Error: BMBState account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate period constraints
    let current_period = get_current_period();
    if input.period <= current_period {
        msg!("Error: New period must be greater than current period ({})", current_period);
        return Err(ProgramError::InvalidArgument);
    }

    let account_exists = !bmb_state_account.data_is_empty();
    let mut bmb_state = if account_exists {
        // Load existing state
        let existing_state: BMBState = read_account_data(
            &bmb_state_account.try_borrow_data()?,
            DepinAccountType::BMBState,
        )?;

        // Validate that new period is larger than the last period in buffer
        if let Some(entries) = existing_state.get_all_entries().last() {
            let (last_period, _) = entries;
            if input.period <= *last_period {
                msg!("Error: New period ({}) must be greater than last period in buffer ({})", 
                     input.period, last_period);
                return Err(ProgramError::InvalidArgument);
            }
        }

        existing_state
    } else {
        // Create new account
        let rent = Rent::get()?;
        let space = BMBState::LEN;
        let rent_lamports = rent.minimum_balance(space);

        msg!("Creating new BMBState account with space: {}", space);

        invoke_signed(
            &system_instruction::create_account(
                admin_account.key,
                &bmb_state_pda,
                rent_lamports,
                space as u64,
                program_id,
            ),
            &[
                admin_account.clone(),
                bmb_state_account.clone(),
                system_program.clone(),
            ],
            &[&[GLOBAL_SEED, STATE_SEED, &[bump_seed]]],
        )?;
        msg!("Created new BMBState account: {}", bmb_state_pda);
        BMBState::new()
    };

    // Add the new period entry
    bmb_state.add_period_entry(input.period, input.checker_count);

    // Write the updated state back to the account
    let mut data = bmb_state_account.try_borrow_mut_data()?;
    write_account_data(&mut data, BMBState::account_type(), &bmb_state)?;

    msg!(
        "BMB state updated successfully: period {} with {} checkers",
        input.period,
        input.checker_count
    );

    Ok(())
}