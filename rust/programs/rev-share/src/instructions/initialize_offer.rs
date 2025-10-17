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

use crate::{
    instructions::input::InitializeOfferInput,
    shared::{
        constants::{BMB_ADMIN, BMB_MINT, USDC_MINT},
        features::{Authority, GlobalState, RevShareOffer},
        utils::{read_account_data, write_account_data},
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
    let global_state_account = next_account_info(account_info_iter)?;
    let new_offer_account = next_account_info(account_info_iter)?;
    let previous_offer_account = next_account_info(account_info_iter)?;
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

    // Validate PDAs
    let (expected_global_state, global_state_bump) = GlobalState::find_pda(program_id);
    if *global_state_account.key != expected_global_state {
        msg!("Error: Invalid global state account");
        return Err(ProgramError::InvalidArgument);
    }

    let (expected_new_offer, new_offer_bump) = RevShareOffer::find_pda(program_id, input.offer_id);
    if *new_offer_account.key != expected_new_offer {
        msg!("Error: Invalid new offer account");
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
    let is_first_offer = global_state_account.data_is_empty();

    // Handle first offer initialization
    if is_first_offer {
        msg!("First offer - initializing global state and treasuries");

        // Validate that offer_id is 1 for first offer
        if input.offer_id != 1 {
            msg!("Error: First offer must have ID 1");
            return Err(ProgramError::InvalidInstructionData);
        }

        // Previous offer should be system program for first offer
        if *previous_offer_account.key != system_program::ID {
            msg!("Error: For first offer, previous offer must be system program");
            return Err(ProgramError::InvalidArgument);
        }

        // Create global state account
        let global_state_space = GlobalState::LEN;
        let global_state_rent = rent.minimum_balance(global_state_space);

        invoke_signed(
            &system_instruction::create_account(
                payer_account.key,
                global_state_account.key,
                global_state_rent,
                global_state_space as u64,
                program_id,
            ),
            &[
                payer_account.clone(),
                global_state_account.clone(),
                system_program_account.clone(),
            ],
            &[&[crate::shared::REVSHARE_SEED, crate::shared::STATE_SEED, &[global_state_bump]]],
        )?;

        // Initialize global state
        let global_state = GlobalState::new();
        let mut global_state_data = global_state_account.try_borrow_mut_data()?;
        write_account_data(&mut global_state_data, GlobalState::account_type(), &global_state)?;

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
        // Subsequent offers - validate sequence and inherit stakes
        let mut global_state: GlobalState = read_account_data(
            &global_state_account.try_borrow_data()?,
            GlobalState::account_type(),
        )?;

        // Validate offer ID is sequential
        if input.offer_id != global_state.last_offer_id + 1 {
            msg!(
                "Error: Offer ID must be sequential. Expected {}, got {}",
                global_state.last_offer_id + 1,
                input.offer_id
            );
            return Err(ProgramError::InvalidInstructionData);
        }

        // Validate previous offer PDA
        let (expected_previous_offer, _) =
            RevShareOffer::find_pda(program_id, global_state.last_offer_id);
        if *previous_offer_account.key != expected_previous_offer {
            msg!("Error: Invalid previous offer account");
            return Err(ProgramError::InvalidArgument);
        }

        // Update global state last_offer_id
        global_state.last_offer_id = input.offer_id;
        let mut global_state_data = global_state_account.try_borrow_mut_data()?;
        write_account_data(&mut global_state_data, GlobalState::account_type(), &global_state)?;
    }

    // Create new offer account
    if !new_offer_account.data_is_empty() {
        msg!("Error: Offer account already exists");
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    let offer_space = RevShareOffer::LEN;
    let offer_rent = rent.minimum_balance(offer_space);

    invoke_signed(
        &system_instruction::create_account(
            payer_account.key,
            new_offer_account.key,
            offer_rent,
            offer_space as u64,
            program_id,
        ),
        &[
            payer_account.clone(),
            new_offer_account.clone(),
            system_program_account.clone(),
        ],
        &[&[
            crate::shared::REVSHARE_SEED,
            crate::shared::OFFER_SEED,
            &input.offer_id.to_le_bytes(),
            &[new_offer_bump],
        ]],
    )?;

    // Initialize offer with inherited stakes
    let mut new_offer = RevShareOffer::new(
        input.offer_id,
        input.start_time,
        input.end_time,
        input.revenue_percentage,
    );

    // Inherit stakes from previous offer if not first offer
    if !is_first_offer {
        let previous_offer: RevShareOffer = read_account_data(
            &previous_offer_account.try_borrow_data()?,
            RevShareOffer::account_type(),
        )?;

        // Inherited stake = previous total_staked - previous total_staked_opted_out
        let inherited_stake = previous_offer
            .total_staked
            .checked_sub(previous_offer.total_staked_opted_out)
            .unwrap_or(0);

        msg!("Inheriting {} tokens from previous offer", inherited_stake);

        new_offer.total_staked = inherited_stake;
        new_offer.total_staked_weighted = inherited_stake; // Full weight for inherited stakes
    }

    // Write new offer
    let mut new_offer_data = new_offer_account.try_borrow_mut_data()?;
    write_account_data(&mut new_offer_data, RevShareOffer::account_type(), &new_offer)?;

    msg!("Offer {} initialized successfully", input.offer_id);

    Ok(())
}
