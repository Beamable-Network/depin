use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::Sysvar,
};
use spl_token::instruction as token_instruction;

use crate::shared::{
    features::{Authority, OfferBook, UserStakePosition},
    utils::{read_account_data, write_account_data},
};

pub fn process_unstake<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    _instruction_data: &[u8],
) -> ProgramResult {
    msg!("Unstaking BMB tokens");

    // Extract accounts
    let account_info_iter = &mut accounts.iter();
    let user_account = next_account_info(account_info_iter)?;
    let user_position_account = next_account_info(account_info_iter)?;
    let offer_book_account = next_account_info(account_info_iter)?;
    let authority_account = next_account_info(account_info_iter)?;
    let user_bmb_account = next_account_info(account_info_iter)?;
    let bmb_treasury_account = next_account_info(account_info_iter)?;
    let token_program_account = next_account_info(account_info_iter)?;

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

    let (expected_authority, authority_bump) = Authority::find_pda(program_id);
    if *authority_account.key != expected_authority {
        msg!("Error: Invalid authority account");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate user position exists
    if user_position_account.data_is_empty() {
        msg!("Error: User has no stake position");
        return Err(ProgramError::UninitializedAccount);
    }

    // Read user position
    let user_position: UserStakePosition = read_account_data(
        &user_position_account.try_borrow_data()?,
        UserStakePosition::account_type(),
    )?;

    // Read offer book
    let mut offer_book: OfferBook = read_account_data(
        &offer_book_account.try_borrow_data()?,
        OfferBook::account_type(),
    )?;

    // Get current time
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;

    // Handle two cases: user opted out, or no active offer
    if user_position.has_opted_out() {
        // Case 1: User has opted out - validate they can unstake
        let opted_out_offer_id = user_position.opted_out_at_offer;

        // Find the offer they opted out during
        let opted_out_offer = offer_book.offers.iter()
            .find(|offer| offer.offer_id == opted_out_offer_id)
            .ok_or_else(|| {
                msg!("Error: Opted out offer {} not found in offer book", opted_out_offer_id);
                ProgramError::InvalidAccountData
            })?;

        // Check if that offer has ended
        if current_time < opted_out_offer.end_time {
            msg!(
                "Error: Cannot unstake until offer {} ends (ends at {})",
                opted_out_offer_id,
                opted_out_offer.end_time
            );
            return Err(ProgramError::InvalidAccountData);
        }

        msg!(
            "User opted out at offer {} which has ended. Proceeding with unstake",
            opted_out_offer_id
        );
    } else {
        // Case 2: User has not opted out - can only unstake if no active offer
        // This requires updating the most recent offer's opted_out total

        let last_offer = offer_book.get_last_offer()
            .ok_or_else(|| {
                msg!("Error: Cannot unstake - no offers exist");
                ProgramError::InvalidAccountData
            })?;

        // Check if there's an active offer
        if current_time >= last_offer.start_time && current_time < last_offer.end_time {
            msg!("Error: Cannot unstake during an active offer. Must opt out first");
            return Err(ProgramError::InvalidAccountData);
        }

        // No active offer - update the last offer's opted_out total
        msg!(
            "No active offer. Adding {} to offer {}'s opted_out total",
            user_position.staked_amount,
            last_offer.offer_id
        );

        // Get mutable reference to the last offer
        let last_offer_mut = offer_book.offers.last_mut()
            .ok_or_else(|| {
                msg!("Error: Cannot get mutable reference to last offer");
                ProgramError::InvalidAccountData
            })?;

        last_offer_mut.total_staked_opted_out = last_offer_mut
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
    }

    // Transfer BMB tokens back to user
    let stake_amount = user_position.staked_amount;
    msg!("Transferring {} BMB tokens back to user", stake_amount);

    invoke_signed(
        &token_instruction::transfer(
            token_program_account.key,
            bmb_treasury_account.key,
            user_bmb_account.key,
            authority_account.key,
            &[],
            stake_amount,
        )?,
        &[
            bmb_treasury_account.clone(),
            user_bmb_account.clone(),
            authority_account.clone(),
            token_program_account.clone(),
        ],
        &[&[crate::shared::REVSHARE_SEED, crate::shared::AUTHORITY_SEED, &[authority_bump]]],
    )?;

    // Close user position account and return rent to user
    let user_position_lamports = user_position_account.lamports();
    **user_position_account.try_borrow_mut_lamports()? = 0;
    **user_account.try_borrow_mut_lamports()? = user_account
        .lamports()
        .checked_add(user_position_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    msg!("Unstaked {} BMB tokens successfully", stake_amount);

    Ok(())
}
