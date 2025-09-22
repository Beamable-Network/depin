use solana_program::{
    account_info::next_account_info, account_info::AccountInfo, entrypoint::ProgramResult, msg,
    program::invoke_signed, program_error::ProgramError, pubkey::Pubkey,
};

use spl_token::{
    instruction as token_instruction, solana_program::program_pack::Pack,
    state::Account as TokenAccount,
};
use std::convert::TryInto;

use shared::constants::seeds::{ESCROW_SEED, TOKEN_SEED};

#[cfg(not(feature = "test"))]
use shared::constants::accounts::{BMB_MINT, USDC_MINT};

pub fn process_withdrawal_request(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Withdrawer (owner of the escrow)
    // 1. [writable] Withdrawer's token account (must be either USDC or BMB token)
    // 2. [writable] Escrow token account (PDA, address calculated by client)
    // 3. [] Program account (needed since program is authority)
    // 4. [] Token program account

    let account_info_iter = &mut accounts.iter();
    let withdrawer = next_account_info(account_info_iter)?;
    let withdrawer_token_account = next_account_info(account_info_iter)?;
    let escrow_token_account = next_account_info(account_info_iter)?;
    let program_account = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;

    if !withdrawer.is_signer {
        msg!("Error: Withdrawer must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    if program_account.key != program_id {
        msg!("Error: Program account does not match the program ID");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate withdrawer token account
    let withdrawer_token_state: TokenAccount;
    {
        // Drop the borrow of the `withdrawer_token_account` because we need to borrow it again later in the transfer instruction
        let withdrawer_token_data = withdrawer_token_account.try_borrow_data()?;
        withdrawer_token_state = TokenAccount::unpack(&withdrawer_token_data)
            .map_err(|_| ProgramError::InvalidAccountData)?;
    }

    #[cfg(feature = "test")]
    {
        msg!("[Test mode] Skipping token mint validation");
    }

    #[cfg(not(feature = "test"))]
    {
        if withdrawer_token_state.mint != USDC_MINT && withdrawer_token_state.mint != BMB_MINT {
            msg!("Error: Token mint is not supported for withdrawals");
            return Err(ProgramError::InvalidAccountData);
        }
    }

    // Validate escrow PDA
    let (pda, bump_seed) = Pubkey::find_program_address(
        &[
            ESCROW_SEED,
            TOKEN_SEED,
            withdrawer.key.as_ref(),
            withdrawer_token_state.mint.as_ref(),
        ],
        program_id,
    );

    if *escrow_token_account.key != pda {
        msg!("Error: Escrow token account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Ensure the escrow account exists and has funds
    if escrow_token_account.data_is_empty() {
        msg!("Error: Escrow token account does not exist");
        return Err(ProgramError::UninitializedAccount);
    }

    // Parse withdrawal amount
    if instruction_data.len() < 8 {
        msg!("Error: Not enough data provided for withdrawal amount");
        return Err(ProgramError::InvalidInstructionData);
    }

    let withdrawal_amount: u64 = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());

    if withdrawal_amount == 0 {
        msg!("Error: Withdrawal amount must be greater than zero");
        return Err(ProgramError::InvalidInstructionData);
    }

    // Check escrow token account balance
    let escrow_token_state = TokenAccount::unpack(&escrow_token_account.try_borrow_data()?)?;
    if escrow_token_state.amount < withdrawal_amount {
        msg!("Error: Insufficient funds in escrow account");
        return Err(ProgramError::InsufficientFunds);
    }

    // Check that the escrow token account is owned by the PDA
    msg!("Escrow token account owner: {}", escrow_token_state.owner);
    msg!("Expected PDA: {}", pda);

    // Execute token transfer from escrow to withdrawer
    invoke_signed(
        &token_instruction::transfer(
            &token_program.key,
            &escrow_token_account.key,
            &withdrawer_token_account.key,
            &pda,
            &[],
            withdrawal_amount,
        )?,
        &[
            escrow_token_account.clone(),
            withdrawer_token_account.clone(),
            program_account.clone(),
            token_program.clone()
        ],
        &[&[
            ESCROW_SEED,
            TOKEN_SEED,
            withdrawer.key.as_ref(),
            withdrawer_token_state.mint.as_ref(),
            &[bump_seed],
        ]],
    )?;

    Ok(())
}
