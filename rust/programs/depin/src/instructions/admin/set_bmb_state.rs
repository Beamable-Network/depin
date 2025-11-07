use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use crate::shared::{
    constants::seeds::{GLOBAL_SEED, STATE_SEED},
    features::global::accounts::BMBState,
};
use depin_core::{
    types::account::DepinAccountType,
    utils::{
        account::{read_account_data, write_account_data},
        program_data::validate_upgrade_authority
    }
};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct SetBMBStateInput {
    pub checkers_desired: Option<u32>,
    pub checkers_activated: Option<u32>,
    pub workers_activated: Option<u32>,
}

pub fn process_set_bmb_state<'info>(
    program_id: &Pubkey,
    accounts: &'info [AccountInfo<'info>],
    instruction_data: &[u8],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Program upgrade authority
    // 1. [readonly] ProgramData account (contains upgrade authority)
    // 2. [writable] BMBState PDA account (must already exist)
    let account_info_iter = &mut accounts.iter();
    let upgrade_authority_account = next_account_info(account_info_iter)?;
    let program_data_account = next_account_info(account_info_iter)?;
    let bmb_state_account = next_account_info(account_info_iter)?;

    let input = SetBMBStateInput::try_from_slice(instruction_data)?;

    // Validate upgrade authority
    validate_upgrade_authority(
        program_id,
        program_data_account,
        upgrade_authority_account
    )?;

    // Validate the PDA
    let (bmb_state_pda, _bump_seed) = Pubkey::find_program_address(
        &[GLOBAL_SEED, STATE_SEED],
        program_id,
    );

    if *bmb_state_account.key != bmb_state_pda {
        msg!("Error: BMBState account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // BMBState account must exist
    if bmb_state_account.data_is_empty() {
        msg!("Error: BMBState account does not exist");
        return Err(ProgramError::UninitializedAccount);
    }

    // Load existing state
    let mut bmb_state: BMBState = read_account_data(
        &bmb_state_account.try_borrow_data()?,
        DepinAccountType::BMBState,
    )?;

    // Update fields if provided
    let mut updated = false;

    if let Some(checkers_desired) = input.checkers_desired {
        msg!("Updating checkers_desired: {} -> {}", bmb_state.checkers_desired, checkers_desired);
        bmb_state.checkers_desired = checkers_desired;
        updated = true;
    }

    if let Some(checkers_activated) = input.checkers_activated {
        msg!("Updating checkers_activated: {} -> {}", bmb_state.checkers_activated, checkers_activated);
        bmb_state.checkers_activated = checkers_activated;
        updated = true;
    }

    if let Some(workers_activated) = input.workers_activated {
        msg!("Updating workers_activated: {} -> {}", bmb_state.workers_activated, workers_activated);
        bmb_state.workers_activated = workers_activated;
        updated = true;
    }

    if !updated {
        msg!("Warning: No fields were updated");
    }

    // Write the updated state back to the account
    let mut data = bmb_state_account.try_borrow_mut_data()?;
    write_account_data(&mut data, BMBState::account_type(), &bmb_state)?;

    msg!("BMB state updated successfully");

    Ok(())
}
