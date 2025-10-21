use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    msg,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::Sysvar,
};
use spl_token::instruction as token_instruction;

use borsh::BorshDeserialize;

use crate::{
    instructions::input::DepositRevenueInput,
    shared::{
        constants::BMB_ADMIN,
        features::OfferBook,
        utils::{read_account_data, write_account_data},
    },
};

pub fn process_deposit_revenue<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse input
    let input = DepositRevenueInput::try_from_slice(instruction_data)?;

    if input.amount == 0 {
        msg!("Error: Deposit amount must be greater than 0");
        return Err(ProgramError::InvalidInstructionData);
    }

    msg!("Depositing {} USDC revenue", input.amount);

    // Extract accounts
    let account_info_iter = &mut accounts.iter();
    let depositor_account = next_account_info(account_info_iter)?;
    let offer_book_account = next_account_info(account_info_iter)?;
    let depositor_usdc_account = next_account_info(account_info_iter)?;
    let usdc_treasury_account = next_account_info(account_info_iter)?;
    let token_program_account = next_account_info(account_info_iter)?;

    // Validate depositor authorization
    #[cfg(not(feature = "test"))]
    {
        // Production: only authorized depositor can call
        // TODO: Update this to the depin program's authority PDA when integrating
        // For now, using admin as placeholder
        const AUTHORIZED_DEPOSITOR: Pubkey = BMB_ADMIN;

        if *depositor_account.key != AUTHORIZED_DEPOSITOR {
            msg!("Error: Only authorized depositor can deposit revenue");
            return Err(ProgramError::InvalidAccountOwner);
        }
    }

    #[cfg(feature = "test")]
    {
        // Test mode: anyone can deposit (for mocking revenue)
        msg!("Test mode: allowing deposit from any account");
    }

    if !depositor_account.is_signer {
        msg!("Error: Depositor must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate PDAs
    let (expected_offer_book, _) = OfferBook::find_pda(program_id);
    if *offer_book_account.key != expected_offer_book {
        msg!("Error: Invalid offer book account");
        return Err(ProgramError::InvalidArgument);
    }

    // Read offer book and find active offer
    let mut offer_book: OfferBook = read_account_data(
        &offer_book_account.try_borrow_data()?,
        OfferBook::account_type(),
    )?;

    // Get current timestamp
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;

    // Find active offer - if none exists, return early without transferring anything
    let active_offer = match offer_book.get_active_offer_mut(current_time) {
        Some(offer) => offer,
        None => {
            msg!("No active offer exists - no revenue collected");
            return Ok(());
        }
    };

    // Calculate revenue share: total_revenue * revenue_percentage / 10000
    // revenue_percentage is in basis points (e.g., 500 = 5%)
    let revenue_share = (input.amount as u128)
        .checked_mul(active_offer.revenue_percentage as u128)
        .and_then(|v| v.checked_div(10000u128))
        .and_then(|v| u64::try_from(v).ok())
        .ok_or(ProgramError::ArithmeticOverflow)?;

    if revenue_share == 0 {
        msg!("Revenue share rounds to 0 - no collection");
        return Ok(());
    }

    msg!(
        "Total revenue: {} USDC, collecting {}% ({} USDC) for offer {}",
        input.amount,
        active_offer.revenue_percentage,
        revenue_share,
        active_offer.offer_id
    );

    let active_offer_id = active_offer.offer_id;
    let old_collected = active_offer.collected_usdc;

    // Update collected USDC
    active_offer.collected_usdc = active_offer
        .collected_usdc
        .checked_add(revenue_share)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let new_collected = active_offer.collected_usdc;

    // Write updated offer book
    let mut offer_book_data = offer_book_account.try_borrow_mut_data()?;
    write_account_data(
        &mut offer_book_data,
        OfferBook::account_type(),
        &offer_book,
    )?;

    // Transfer only the revenue share from depositor to treasury
    invoke(
        &token_instruction::transfer(
            token_program_account.key,
            depositor_usdc_account.key,
            usdc_treasury_account.key,
            depositor_account.key,
            &[],
            revenue_share,
        )?,
        &[
            depositor_usdc_account.clone(),
            usdc_treasury_account.clone(),
            depositor_account.clone(),
            token_program_account.clone(),
        ],
    )?;

    msg!(
        "Offer {} collected USDC updated: {} -> {}",
        active_offer_id,
        old_collected,
        new_collected
    );

    Ok(())
}
