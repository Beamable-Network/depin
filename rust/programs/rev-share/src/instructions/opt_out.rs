use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::shared::{
    features::{GlobalState, RevShareOffer, UserStakePosition},
    utils::{read_account_data, write_account_data},
};

pub fn process_opt_out_rollover<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    _instruction_data: &[u8],
) -> ProgramResult {
    msg!("Opting out of future rollover");

    // Extract accounts
    let account_info_iter = &mut accounts.iter();
    let user_account = next_account_info(account_info_iter)?;
    let user_position_account = next_account_info(account_info_iter)?;
    let global_state_account = next_account_info(account_info_iter)?;
    let active_offer_account = next_account_info(account_info_iter)?;

    // Validate signer
    if !user_account.is_signer {
        msg!("Error: User must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate PDAs
    let (expected_user_position, _) = UserStakePosition::find_pda(program_id, user_account.key);
    if *user_position_account.key != expected_user_position {
        msg!("Error: Invalid user position account");
        return Err(ProgramError::InvalidArgument);
    }

    let (expected_global_state, _) = GlobalState::find_pda(program_id);
    if *global_state_account.key != expected_global_state {
        msg!("Error: Invalid global state account");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate user position exists
    if user_position_account.data_is_empty() {
        msg!("Error: User has no stake position");
        return Err(ProgramError::UninitializedAccount);
    }

    // Read user position
    let mut user_position: UserStakePosition = read_account_data(
        &user_position_account.try_borrow_data()?,
        UserStakePosition::account_type(),
    )?;

    // Check if already opted out
    if user_position.has_opted_out() {
        msg!("Error: User has already opted out");
        return Err(ProgramError::InvalidAccountData);
    }

    // Read global state to get current active offer
    let global_state: GlobalState = read_account_data(
        &global_state_account.try_borrow_data()?,
        GlobalState::account_type(),
    )?;

    if global_state.last_offer_id == 0 {
        msg!("Error: No active offer exists");
        return Err(ProgramError::InvalidAccountData);
    }

    // Validate active offer
    let (expected_active_offer, _) = RevShareOffer::find_pda(program_id, global_state.last_offer_id);
    if *active_offer_account.key != expected_active_offer {
        msg!("Error: Invalid active offer account");
        return Err(ProgramError::InvalidArgument);
    }

    // Read active offer
    let mut active_offer: RevShareOffer = read_account_data(
        &active_offer_account.try_borrow_data()?,
        RevShareOffer::account_type(),
    )?;

    // Update offer's opted out total
    active_offer.total_staked_opted_out = active_offer
        .total_staked_opted_out
        .checked_add(user_position.staked_amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // Write updated offer
    let mut active_offer_data = active_offer_account.try_borrow_mut_data()?;
    write_account_data(
        &mut active_offer_data,
        RevShareOffer::account_type(),
        &active_offer,
    )?;

    // Mark user as opted out at current offer
    user_position.opted_out_at_offer = global_state.last_offer_id;

    // Write updated user position
    let mut user_position_data = user_position_account.try_borrow_mut_data()?;
    write_account_data(
        &mut user_position_data,
        UserStakePosition::account_type(),
        &user_position,
    )?;

    msg!(
        "User opted out at offer {}. Stake amount {} marked as opted out",
        global_state.last_offer_id,
        user_position.staked_amount
    );

    Ok(())
}
