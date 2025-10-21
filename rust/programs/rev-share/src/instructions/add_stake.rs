use borsh::BorshDeserialize;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    msg,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};
use spl_token::instruction as token_instruction;

use crate::{
    instructions::input::AddStakeInput,
    shared::{
        features::{OfferBook, StakeEntry, UserStakePosition},
        utils::{read_account_data, reallocate_account_if_needed, write_account_data},
    },
};

pub fn process_add_stake<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse input
    let input = AddStakeInput::try_from_slice(instruction_data)?;

    if input.amount == 0 {
        msg!("Error: Stake amount must be greater than 0");
        return Err(ProgramError::InvalidInstructionData);
    }

    msg!("Adding {} BMB tokens to stake", input.amount);

    // Extract accounts
    let account_info_iter = &mut accounts.iter();
    let user_account = next_account_info(account_info_iter)?;
    let payer_account = next_account_info(account_info_iter)?;
    let user_position_account = next_account_info(account_info_iter)?;
    let offer_book_account = next_account_info(account_info_iter)?;
    let user_bmb_account = next_account_info(account_info_iter)?;
    let bmb_treasury_account = next_account_info(account_info_iter)?;
    let token_program_account = next_account_info(account_info_iter)?;
    let system_program_account = next_account_info(account_info_iter)?;

    // Validate signers
    if !user_account.is_signer {
        msg!("Error: User must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    if !payer_account.is_signer {
        msg!("Error: Payer must sign the transaction");
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
        msg!("Error: User has no stake position. Use Stake instead");
        return Err(ProgramError::UninitializedAccount);
    }

    // Read user position
    let mut user_position: UserStakePosition = read_account_data(
        &user_position_account.try_borrow_data()?,
        UserStakePosition::account_type(),
    )?;

    // Check if user has opted out
    if user_position.has_opted_out() {
        msg!("Error: Cannot add stake after opting out");
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

    // Calculate weight for this additional stake
    let weight = active_offer.calculate_stake_weight(input.amount, current_time);

    msg!(
        "Additional stake weight: {} ({}% of amount)",
        weight,
        (weight * 100) / input.amount.max(1)
    );

    // Update offer totals
    active_offer.total_staked = active_offer
        .total_staked
        .checked_add(input.amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    active_offer.total_staked_weighted = active_offer
        .total_staked_weighted
        .checked_add(weight)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // Write updated offer book
    let mut offer_book_data = offer_book_account.try_borrow_mut_data()?;
    write_account_data(
        &mut offer_book_data,
        OfferBook::account_type(),
        &offer_book,
    )?;

    // Create new stake entry
    let stake_entry = StakeEntry {
        amount: input.amount,
        timestamp: current_time,
    };

    // Update user position
    user_position.staked_amount = user_position
        .staked_amount
        .checked_add(input.amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    user_position.stake_entries.push(stake_entry);

    // Reallocate account if needed for the new stake entry
    let rent = Rent::get()?;
    let required_space = user_position.len();

    reallocate_account_if_needed(
        payer_account,
        user_position_account,
        system_program_account,
        &rent,
        required_space,
    )?;

    // Write updated user position
    let mut user_position_data = user_position_account.try_borrow_mut_data()?;
    write_account_data(
        &mut user_position_data,
        UserStakePosition::account_type(),
        &user_position,
    )?;

    // Transfer BMB tokens from user to treasury
    msg!("Transferring {} BMB tokens to treasury", input.amount);
    invoke(
        &token_instruction::transfer(
            token_program_account.key,
            user_bmb_account.key,
            bmb_treasury_account.key,
            user_account.key,
            &[],
            input.amount,
        )?,
        &[
            user_bmb_account.clone(),
            bmb_treasury_account.clone(),
            user_account.clone(),
            token_program_account.clone(),
        ],
    )?;

    msg!("Added {} BMB tokens to stake successfully", input.amount);

    Ok(())
}
