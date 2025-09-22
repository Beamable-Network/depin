use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    system_instruction,
    sysvar::{rent::Rent, Sysvar},
};

use spl_token::{
    instruction as token_instruction, solana_program::program_pack::Pack,
    state::Account as TokenAccount, ID as TOKEN_PROGRAM_ID,
};
use std::convert::TryInto;

use shared::constants::seeds::{ESCROW_SEED, TOKEN_SEED};

#[cfg(not(feature = "test"))]
use shared::constants::accounts::{BMB_MINT, USDC_MINT};

pub fn process_deposit_request(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Depositor
    // 1. [writable] Depositor's token account (must be either USDC or BMB token)
    // 2. [writable] Escrow token account (PDA, address calculated by client)
    // 4. [] Mint account
    // 5. [] Token program account
    // 6. [] System program account (for account creation if needed)

    let account_info_iter = &mut accounts.iter();
    let depositor = next_account_info(account_info_iter)?;
    let depositor_token_account = next_account_info(account_info_iter)?;
    let escrow_token_account = next_account_info(account_info_iter)?;
    let mint_account = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;
    
    if !depositor.is_signer {
        msg!("Error: Depositor must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate depositor token account
    let depositor_token_state: TokenAccount;
    { // Drop the borrow of the `depositor_token_account` because we need to borrow it again later in the transfer instruction
        let depositor_token_data = depositor_token_account.try_borrow_data()?;
        depositor_token_state = TokenAccount::unpack(&depositor_token_data)
            .map_err(|_| ProgramError::InvalidAccountData)?;
    } 

    #[cfg(feature = "test")]
    {
        msg!("[Test mode] Skipping token mint validation");
    }

    #[cfg(not(feature = "test"))]
    {
        if depositor_token_state.mint != USDC_MINT && depositor_token_state.mint != BMB_MINT {
            msg!("Error: Token mint is not supported for deposits");
            return Err(ProgramError::InvalidAccountData);
        }
    }

    if *mint_account.key != depositor_token_state.mint {
        msg!("Error: Mint account does not match token account mint");
        return Err(ProgramError::InvalidAccountData);
    }

    // Validate escrow PDA
    let (pda, bump_seed) = Pubkey::find_program_address(
        &[
            ESCROW_SEED,
            TOKEN_SEED,
            depositor.key.as_ref(),
            depositor_token_state.mint.as_ref(),
        ],
        program_id,
    );

    if *escrow_token_account.key != pda {
        msg!("Error: Escrow token account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    if escrow_token_account.data_is_empty() {
        msg!("Initializing escrow token account at address: {}", pda);
        // Calculate rent-exempt minimum balance
        let rent = Rent::get()?;
        let space = TokenAccount::LEN;
        let rent_lamports = rent.minimum_balance(space);

        // Create the token account
        invoke_signed(
            &system_instruction::create_account(
                depositor.key,
                &pda,
                rent_lamports,
                space as u64,
                &TOKEN_PROGRAM_ID,
            ),
            &[
                depositor.clone(),
                escrow_token_account.clone(),
                system_program.clone(),
            ],
            &[&[
                ESCROW_SEED,
                TOKEN_SEED,
                depositor.key.as_ref(),
                depositor_token_state.mint.as_ref(),
                &[bump_seed],
            ]],
        )?;

        // Initialize as a token account
        invoke_signed(
            &token_instruction::initialize_account3(
                &TOKEN_PROGRAM_ID,
                &pda,
                &depositor_token_state.mint,
                &pda
            )?,
            &[
                escrow_token_account.clone(),
                mint_account.clone()
                ],
            &[&[
                ESCROW_SEED,
                TOKEN_SEED,
                depositor.key.as_ref(),
                depositor_token_state.mint.as_ref(),
                &[bump_seed],
            ]],
        )?;
    }

    msg!(&instruction_data.len().to_string());

    // Parse deposit amount
    if instruction_data.len() < 8 {
        msg!("Error: Not enough data provided for deposit amount");
        return Err(ProgramError::InvalidInstructionData);
    }

    let deposit_amount: u64 = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());

    if deposit_amount == 0 {
        msg!("Error: Deposit amount must be greater than zero");
        return Err(ProgramError::InvalidInstructionData);
    }

    // Execute token transfer
    invoke(
        &token_instruction::transfer(
            &token_program.key,
            &depositor_token_account.key,
            &escrow_token_account.key,
            &depositor.key,
            &[],
            deposit_amount,
        )?,
        &[
            depositor.clone(),
            depositor_token_account.clone(),
            escrow_token_account.clone(),
            token_program.clone(),
        ]
    )?;

    Ok(())
}
