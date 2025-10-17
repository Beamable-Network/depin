use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use spl_token::instruction as token_instruction;

use borsh::BorshDeserialize;

use crate::{
    instructions::input::DepositRevenueInput,
    shared::{
        constants::BMB_ADMIN,
        features::{GlobalState, RevShareOffer},
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
    let global_state_account = next_account_info(account_info_iter)?;
    let active_offer_account = next_account_info(account_info_iter)?;
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
    let (expected_global_state, _) = GlobalState::find_pda(program_id);
    if *global_state_account.key != expected_global_state {
        msg!("Error: Invalid global state account");
        return Err(ProgramError::InvalidArgument);
    }

    // Read global state to get current active offer
    if global_state_account.data_is_empty() {
        msg!("Error: Global state not initialized");
        return Err(ProgramError::UninitializedAccount);
    }

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

    if active_offer_account.data_is_empty() {
        msg!("Error: Active offer not initialized");
        return Err(ProgramError::UninitializedAccount);
    }

    // Read active offer
    let mut active_offer: RevShareOffer = read_account_data(
        &active_offer_account.try_borrow_data()?,
        RevShareOffer::account_type(),
    )?;

    // Update collected USDC
    active_offer.collected_usdc = active_offer
        .collected_usdc
        .checked_add(input.amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    msg!(
        "Offer {} collected USDC updated: {} -> {}",
        active_offer.offer_id,
        active_offer.collected_usdc - input.amount,
        active_offer.collected_usdc
    );

    // Write updated offer
    let mut active_offer_data = active_offer_account.try_borrow_mut_data()?;
    write_account_data(
        &mut active_offer_data,
        RevShareOffer::account_type(),
        &active_offer,
    )?;

    // Transfer USDC from depositor to treasury
    invoke(
        &token_instruction::transfer(
            token_program_account.key,
            depositor_usdc_account.key,
            usdc_treasury_account.key,
            depositor_account.key,
            &[],
            input.amount,
        )?,
        &[
            depositor_usdc_account.clone(),
            usdc_treasury_account.clone(),
            depositor_account.clone(),
            token_program_account.clone(),
        ],
    )?;

    msg!(
        "Deposited {} USDC to offer {} treasury",
        input.amount,
        active_offer.offer_id
    );

    Ok(())
}
