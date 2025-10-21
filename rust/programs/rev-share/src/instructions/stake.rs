use borsh::BorshDeserialize;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    msg,
    program::invoke,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};
use spl_token::instruction as token_instruction;

use crate::{
    instructions::input::StakeInput,
    shared::{
        features::{OfferBook, StakeEntry, UserStakePosition},
        utils::{read_account_data, write_account_data},
    },
};

pub fn process_stake<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse input
    let input = StakeInput::try_from_slice(instruction_data)?;

    if input.amount == 0 {
        msg!("Error: Stake amount must be greater than 0");
        return Err(ProgramError::InvalidInstructionData);
    }

    msg!("Staking {} BMB tokens", input.amount);

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
    let (expected_user_position, user_position_bump) =
        UserStakePosition::find_pda(program_id, user_account.key);
    if *user_position_account.key != expected_user_position {
        msg!("Error: Invalid user position account");
        return Err(ProgramError::InvalidArgument);
    }

    let (expected_offer_book, _) = OfferBook::find_pda(program_id);
    if *offer_book_account.key != expected_offer_book {
        msg!("Error: Invalid offer book account");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate user position doesn't exist yet
    if !user_position_account.data_is_empty() {
        msg!("Error: User already has a stake position. Use AddStake instead");
        return Err(ProgramError::AccountAlreadyInitialized);
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

    // Calculate weight for this stake
    let weight = active_offer.calculate_stake_weight(input.amount, current_time);

    msg!("Stake weight: {} ({}% of amount)", weight, (weight * 100) / input.amount);

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

    // Create stake entry
    let stake_entry = StakeEntry {
        amount: input.amount,
        timestamp: current_time,
    };

    // Create user position
    let mut user_position = UserStakePosition::new(*user_account.key);
    user_position.staked_amount = input.amount;
    user_position.stake_entries.push(stake_entry);

    // Create user position account
    let rent = Rent::get()?;
    let user_position_space = user_position.len();
    let user_position_rent = rent.minimum_balance(user_position_space);

    invoke_signed(
        &system_instruction::create_account(
            payer_account.key,
            user_position_account.key,
            user_position_rent,
            user_position_space as u64,
            program_id,
        ),
        &[
            payer_account.clone(),
            user_position_account.clone(),
            system_program_account.clone(),
        ],
        &[&[crate::shared::REVSHARE_SEED, crate::shared::USER_SEED, user_account.key.as_ref(), &[user_position_bump]]],
    )?;

    // Initialize user position data
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

    msg!("Staked {} BMB tokens successfully", input.amount);

    Ok(())
}
