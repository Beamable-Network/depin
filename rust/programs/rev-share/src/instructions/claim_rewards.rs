use borsh::BorshDeserialize;
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

use crate::{
    instructions::input::ClaimRewardsInput,
    shared::{
        features::{Authority, OfferBook, UserStakePosition},
        utils::{read_account_data, write_account_data},
    },
};

pub fn process_claim_rewards<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse input
    let input = ClaimRewardsInput::try_from_slice(instruction_data)?;

    msg!("Claiming rewards from offer {}", input.offer_id);

    // Extract accounts
    let account_info_iter = &mut accounts.iter();
    let user_account = next_account_info(account_info_iter)?;
    let user_position_account = next_account_info(account_info_iter)?;
    let offer_book_account = next_account_info(account_info_iter)?;
    let authority_account = next_account_info(account_info_iter)?;
    let user_usdc_account = next_account_info(account_info_iter)?;
    let usdc_treasury_account = next_account_info(account_info_iter)?;
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
    let mut user_position: UserStakePosition = read_account_data(
        &user_position_account.try_borrow_data()?,
        UserStakePosition::account_type(),
    )?;

    // Validate sequential claiming
    let expected_offer_id = user_position.last_claimed_offer + 1;
    if input.offer_id != expected_offer_id {
        msg!(
            "Error: Must claim offers sequentially. Expected {}, got {}",
            expected_offer_id,
            input.offer_id
        );
        return Err(ProgramError::InvalidInstructionData);
    }

    // Check eligibility
    if !user_position.is_eligible_for_offer(input.offer_id) {
        msg!(
            "Error: User not eligible for offer {}. Opted out at offer {}",
            input.offer_id,
            user_position.opted_out_at_offer
        );
        return Err(ProgramError::InvalidAccountData);
    }

    // Read offer book and find the specific offer
    let offer_book: OfferBook = read_account_data(
        &offer_book_account.try_borrow_data()?,
        OfferBook::account_type(),
    )?;

    let claim_offer = offer_book.find_offer(input.offer_id)
        .ok_or_else(|| {
            msg!("Error: Offer {} not found in offer book", input.offer_id);
            ProgramError::InvalidAccountData
        })?;

    // Validate offer has ended
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;

    if current_time < claim_offer.end_time {
        msg!(
            "Error: Offer {} has not ended yet (ends at {})",
            input.offer_id,
            claim_offer.end_time
        );
        return Err(ProgramError::InvalidAccountData);
    }

    // Calculate user's weighted stake for this offer
    let user_weighted_stake = user_position.calculate_weighted_stake_for_offer(&claim_offer);

    msg!("User weighted stake: {}", user_weighted_stake);
    msg!("Offer total weighted stake: {}", claim_offer.total_staked_weighted);
    msg!("Offer collected USDC: {}", claim_offer.collected_usdc);

    // Handle edge cases
    if user_weighted_stake == 0 {
        msg!("User has no weighted stake for this offer");
        // Still update last_claimed_offer to allow claiming future offers
        user_position.last_claimed_offer = input.offer_id;

        let mut user_position_data = user_position_account.try_borrow_mut_data()?;
        write_account_data(
            &mut user_position_data,
            UserStakePosition::account_type(),
            &user_position,
        )?;

        return Ok(());
    }

    if claim_offer.total_staked_weighted == 0 {
        msg!("Error: Offer has no weighted stakes (should not happen)");
        return Err(ProgramError::InvalidAccountData);
    }

    if claim_offer.collected_usdc == 0 {
        msg!("No USDC collected for this offer");
        // Still update last_claimed_offer
        user_position.last_claimed_offer = input.offer_id;

        let mut user_position_data = user_position_account.try_borrow_mut_data()?;
        write_account_data(
            &mut user_position_data,
            UserStakePosition::account_type(),
            &user_position,
        )?;

        return Ok(());
    }

    // Calculate reward: (user_weighted / total_weighted) × collected_usdc
    // Using u128 to prevent overflow during multiplication
    let reward_amount = (user_weighted_stake as u128)
        .checked_mul(claim_offer.collected_usdc as u128)
        .and_then(|v| v.checked_div(claim_offer.total_staked_weighted as u128))
        .and_then(|v| u64::try_from(v).ok())
        .ok_or(ProgramError::ArithmeticOverflow)?;

    msg!("Calculated reward: {} USDC", reward_amount);

    if reward_amount == 0 {
        msg!("Reward rounds down to 0 USDC");
        // Still update last_claimed_offer
        user_position.last_claimed_offer = input.offer_id;

        let mut user_position_data = user_position_account.try_borrow_mut_data()?;
        write_account_data(
            &mut user_position_data,
            UserStakePosition::account_type(),
            &user_position,
        )?;

        return Ok(());
    }

    // Transfer USDC reward to user
    invoke_signed(
        &token_instruction::transfer(
            token_program_account.key,
            usdc_treasury_account.key,
            user_usdc_account.key,
            authority_account.key,
            &[],
            reward_amount,
        )?,
        &[
            usdc_treasury_account.clone(),
            user_usdc_account.clone(),
            authority_account.clone(),
            token_program_account.clone(),
        ],
        &[&[crate::shared::REVSHARE_SEED, crate::shared::AUTHORITY_SEED, &[authority_bump]]],
    )?;

    // Update user's last claimed offer
    user_position.last_claimed_offer = input.offer_id;

    let mut user_position_data = user_position_account.try_borrow_mut_data()?;
    write_account_data(
        &mut user_position_data,
        UserStakePosition::account_type(),
        &user_position,
    )?;

    msg!("Claimed {} USDC from offer {}", reward_amount, input.offer_id);

    Ok(())
}
