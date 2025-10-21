use borsh::BorshDeserialize;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    system_program,
    sysvar::Sysvar,
};
use spl_associated_token_account::get_associated_token_address;

#[cfg(not(feature = "test"))]
use crate::shared::constants::BMB_ADMIN;

use crate::{
    instructions::input::InitializeOfferInput,
    shared::{
        constants::{BMB_MINT, USDC_MINT},
        features::{Authority, OfferBook, Offer},
        utils::{read_account_data, write_account_data, resize_account},
    },
};

pub fn process_initialize_offer<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse input
    let input = InitializeOfferInput::try_from_slice(instruction_data)?;

    msg!("Initializing offer {} from {} to {}", input.offer_id, input.start_time, input.end_time);

    // Extract accounts
    let account_info_iter = &mut accounts.iter();
    let admin_account = next_account_info(account_info_iter)?;
    let payer_account = next_account_info(account_info_iter)?;
    let offer_book_account = next_account_info(account_info_iter)?;
    let authority_account = next_account_info(account_info_iter)?;
    let bmb_treasury_account = next_account_info(account_info_iter)?;
    let usdc_treasury_account = next_account_info(account_info_iter)?;
    let bmb_mint_account = next_account_info(account_info_iter)?;
    let usdc_mint_account = next_account_info(account_info_iter)?;
    let token_program_account = next_account_info(account_info_iter)?;
    let associated_token_program_account = next_account_info(account_info_iter)?;
    let system_program_account = next_account_info(account_info_iter)?;

    // Validate admin
    #[cfg(not(feature = "test"))]
    {
        if *admin_account.key != BMB_ADMIN {
            msg!("Error: Only admin can initialize offers");
            return Err(ProgramError::InvalidAccountOwner);
        }
    }

    if !admin_account.is_signer {
        msg!("Error: Admin must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    if !payer_account.is_signer {
        msg!("Error: Payer must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate input times
    if input.end_time <= input.start_time {
        msg!("Error: End time must be after start time");
        return Err(ProgramError::InvalidInstructionData);
    }

    // Validate start time is in the future
    let current_time = solana_program::clock::Clock::get()?.unix_timestamp;
    if input.start_time <= current_time {
        msg!("Error: Start time must be in the future");
        return Err(ProgramError::InvalidInstructionData);
    }

    // Validate PDAs
    let (expected_offer_book, offer_book_bump) = OfferBook::find_pda(program_id);
    if *offer_book_account.key != expected_offer_book {
        msg!("Error: Invalid offer book account");
        return Err(ProgramError::InvalidArgument);
    }

    let (expected_authority, authority_bump) = Authority::find_pda(program_id);
    if *authority_account.key != expected_authority {
        msg!("Error: Invalid authority account");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate system program
    if *system_program_account.key != system_program::ID {
        msg!("Error: Invalid system program");
        return Err(ProgramError::IncorrectProgramId);
    }

    let rent = Rent::get()?;
    let is_first_offer = offer_book_account.data_is_empty();

    // Handle first offer initialization
    if is_first_offer {
        msg!("First offer - initializing offer book and treasuries");

        // Validate that offer_id is 1 for first offer
        if input.offer_id != 1 {
            msg!("Error: First offer must have ID 1");
            return Err(ProgramError::InvalidInstructionData);
        }

        // Create offer book account with initial size (holds ~17 offers in 1KB)
        let offer_book_space = 1024; // 1KB should be enough for most use cases
        let offer_book_rent = rent.minimum_balance(offer_book_space);

        invoke_signed(
            &system_instruction::create_account(
                payer_account.key,
                offer_book_account.key,
                offer_book_rent,
                offer_book_space as u64,
                program_id,
            ),
            &[
                payer_account.clone(),
                offer_book_account.clone(),
                system_program_account.clone(),
            ],
            &[&[crate::shared::OFFER_BOOK_SEED, &[offer_book_bump]]],
        )?;

        // Initialize offer book with first offer
        let mut offer_book = OfferBook::new();
        let new_offer = Offer::new(
            input.offer_id,
            input.start_time,
            input.end_time,
            input.revenue_percentage,
        );
        offer_book.offers.push(new_offer);

        let mut offer_book_data = offer_book_account.try_borrow_mut_data()?;
        write_account_data(&mut offer_book_data, OfferBook::account_type(), &offer_book)?;

        // Validate mint accounts
        if *bmb_mint_account.key != BMB_MINT {
            msg!("Error: Invalid BMB mint");
            return Err(ProgramError::InvalidArgument);
        }

        if *usdc_mint_account.key != USDC_MINT {
            msg!("Error: Invalid USDC mint");
            return Err(ProgramError::InvalidArgument);
        }

        // Validate treasury ATAs
        let expected_bmb_treasury = get_associated_token_address(authority_account.key, &BMB_MINT);
        let expected_usdc_treasury = get_associated_token_address(authority_account.key, &USDC_MINT);

        if *bmb_treasury_account.key != expected_bmb_treasury {
            msg!("Error: Invalid BMB treasury ATA");
            return Err(ProgramError::InvalidArgument);
        }

        if *usdc_treasury_account.key != expected_usdc_treasury {
            msg!("Error: Invalid USDC treasury ATA");
            return Err(ProgramError::InvalidArgument);
        }

        // Create BMB treasury ATA if needed
        if bmb_treasury_account.data_is_empty() {
            msg!("Creating BMB treasury ATA");

            invoke_signed(
                &spl_associated_token_account::instruction::create_associated_token_account(
                    payer_account.key,
                    authority_account.key,
                    &BMB_MINT,
                    token_program_account.key,
                ),
                &[
                    payer_account.clone(),
                    bmb_treasury_account.clone(),
                    authority_account.clone(),
                    bmb_mint_account.clone(),
                    system_program_account.clone(),
                    token_program_account.clone(),
                    associated_token_program_account.clone(),
                ],
                &[&[crate::shared::REVSHARE_SEED, crate::shared::AUTHORITY_SEED, &[authority_bump]]],
            )?;
        }

        // Create USDC treasury ATA if needed
        if usdc_treasury_account.data_is_empty() {
            msg!("Creating USDC treasury ATA");

            invoke_signed(
                &spl_associated_token_account::instruction::create_associated_token_account(
                    payer_account.key,
                    authority_account.key,
                    &USDC_MINT,
                    token_program_account.key,
                ),
                &[
                    payer_account.clone(),
                    usdc_treasury_account.clone(),
                    authority_account.clone(),
                    usdc_mint_account.clone(),
                    system_program_account.clone(),
                    token_program_account.clone(),
                    associated_token_program_account.clone(),
                ],
                &[&[crate::shared::REVSHARE_SEED, crate::shared::AUTHORITY_SEED, &[authority_bump]]],
            )?;
        }
    } else {
        // Subsequent offers - load offer book, compact, add new offer
        let mut offer_book: OfferBook = read_account_data(
            &offer_book_account.try_borrow_data()?,
            OfferBook::account_type(),
        )?;

        // Validate offer ID is sequential and calculate inherited stake
        let (_expected_offer_id, inherited_stake) = {
            let last_offer = offer_book.get_last_offer()
                .ok_or_else(|| {
                    msg!("Error: OfferBook has no offers");
                    ProgramError::InvalidAccountData
                })?;

            if input.offer_id != last_offer.offer_id + 1 {
                msg!(
                    "Error: Offer ID must be sequential. Expected {}, got {}",
                    last_offer.offer_id + 1,
                    input.offer_id
                );
                return Err(ProgramError::InvalidInstructionData);
            }

            // Validate new offer starts after previous offer ends
            if input.start_time <= last_offer.end_time {
                msg!(
                    "Error: New offer start time ({}) must be after previous offer end time ({})",
                    input.start_time,
                    last_offer.end_time
                );
                return Err(ProgramError::InvalidInstructionData);
            }

            // Calculate inherited stake from last offer
            let inherited = last_offer
                .total_staked
                .checked_sub(last_offer.total_staked_opted_out)
                .unwrap_or(0);

            (last_offer.offer_id + 1, inherited)
        };

        // Compact expired offers before adding new one
        msg!("Compacting expired offers");
        offer_book.compact_expired_offers(current_time);

        msg!("Inheriting {} tokens from previous offer", inherited_stake);

        // Create new offer with inherited stakes
        let mut new_offer = Offer::new(
            input.offer_id,
            input.start_time,
            input.end_time,
            input.revenue_percentage,
        );
        new_offer.total_staked = inherited_stake;
        new_offer.total_staked_weighted = inherited_stake; // Full weight for inherited stakes

        // Add new offer to the book
        offer_book.offers.push(new_offer);

        // Check if we need to resize the account
        let new_size = offer_book.len();
        if new_size > offer_book_account.data_len() {
            msg!("Resizing offer book account from {} to {}", offer_book_account.data_len(), new_size);
            resize_account(
                offer_book_account,
                new_size,
                payer_account,
                system_program_account,
            )?;
        }

        // Write updated offer book
        let mut offer_book_data = offer_book_account.try_borrow_mut_data()?;
        write_account_data(&mut offer_book_data, OfferBook::account_type(), &offer_book)?;
    }

    msg!("Offer {} initialized successfully", input.offer_id);

    Ok(())
}
