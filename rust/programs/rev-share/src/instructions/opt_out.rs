use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::Sysvar,
};

use crate::shared::{
    features::{OfferBook, UserStakePosition},
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
    let offer_book_account = next_account_info(account_info_iter)?;

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

    let (expected_offer_book, _) = OfferBook::find_pda(program_id);
    if *offer_book_account.key != expected_offer_book {
        msg!("Error: Invalid offer book account");
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

    // Read offer book and find active offer
    let mut offer_book: OfferBook = read_account_data(
        &offer_book_account.try_borrow_data()?,
        OfferBook::account_type(),
    )?;

    // Get current timestamp
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;

    // Find active offer
    let active_offer = offer_book.get_active_offer_mut(current_time)
        .ok_or_else(|| {
            msg!("Error: No active offer exists");
            ProgramError::InvalidAccountData
        })?;

    // Store the offer ID before updating
    let current_offer_id = active_offer.offer_id;

    // Update offer's opted out total
    active_offer.total_staked_opted_out = active_offer
        .total_staked_opted_out
        .checked_add(user_position.staked_amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // Write updated offer book
    let mut offer_book_data = offer_book_account.try_borrow_mut_data()?;
    write_account_data(
        &mut offer_book_data,
        OfferBook::account_type(),
        &offer_book,
    )?;

    // Mark user as opted out at current offer
    user_position.opted_out_at_offer = current_offer_id;

    // Write updated user position
    let mut user_position_data = user_position_account.try_borrow_mut_data()?;
    write_account_data(
        &mut user_position_data,
        UserStakePosition::account_type(),
        &user_position,
    )?;

    msg!(
        "User opted out at offer {}. Stake amount {} marked as opted out",
        current_offer_id,
        user_position.staked_amount
    );

    Ok(())
}
