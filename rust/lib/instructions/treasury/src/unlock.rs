use borsh::BorshDeserialize;
use solana_program::{
    account_info::{next_account_info, AccountInfo}, 
    entrypoint::ProgramResult, 
    msg, 
    program_error::ProgramError, 
    pubkey::Pubkey
};
use shared::{
    features::treasury::{accounts::{TreasuryState, LockedTokens}, utils::unlock as unlock_tokens},
    utils::account::read_account_data
};
use crate::input;

pub fn process_unlock<'info>(
    program_id: &Pubkey,
    accounts: &'info [AccountInfo<'info>],
    instruction_data: &[u8],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Token owner (must be the owner of the locked tokens)
    // 1. [writable] TreasuryState PDA account
    // 2. [writable] Treasury ATA account (treasury authority's associated token account)
    // 3. [readonly] Treasury authority PDA account
    // 4. [writable] LockedTokens PDA account (will be read and tokens released)
    // 5. [writable] Owner's BMB token account (where unlocked tokens will be sent)
    // 6. [readonly] Token program

    let account_info_iter = &mut accounts.iter();
    let signer_account = next_account_info(account_info_iter)?;
    let treasury_state_account = next_account_info(account_info_iter)?;
    let treasury_ata_account = next_account_info(account_info_iter)?;
    let treasury_authority_account = next_account_info(account_info_iter)?;
    let locked_tokens_account = next_account_info(account_info_iter)?;
    let owner_token_account = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;

    // Check signer is actually signing
    if !signer_account.is_signer {
        msg!("Error: Token owner must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    let input = input::UnlockInput::try_from_slice(instruction_data)?;

    // Validate TreasuryState PDA
    let (treasury_state_pda, _) = TreasuryState::find_pda(program_id);
    if treasury_state_account.key != &treasury_state_pda {
        msg!("Error: TreasuryState account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate LockedTokens PDA by reading its contents
    if locked_tokens_account.data_is_empty() {
        msg!("Error: LockedTokens account does not exist");
        return Err(ProgramError::UninitializedAccount);
    }

    let locked: LockedTokens = read_account_data(
        &locked_tokens_account.try_borrow_data()?,
        LockedTokens::account_type(),
    )?;

    // Ensure the provided lock_period matches the account's lock_period
    if input.lock_period != locked.lock_period {
        msg!("Error: Provided lock period does not match locked tokens");
        return Err(ProgramError::InvalidArgument);
    }

    // Check PDA derivation (owner + lock + unlock period)
    let (expected_locked_tokens_pda, _) = LockedTokens::find_pda(
        program_id,
        &locked.owner,
        locked.lock_period,
        locked.unlock_period,
    );
    if locked_tokens_account.key != &expected_locked_tokens_pda {
        msg!("Error: LockedTokens account address is invalid for its schedule");
        return Err(ProgramError::InvalidArgument);
    }

    // Call the unlock utility function
    unlock_tokens(
        program_id,
        signer_account,
        treasury_state_account,
        treasury_ata_account,
        treasury_authority_account,
        locked_tokens_account,
        owner_token_account,
        token_program,
    )?;

    msg!("Successfully processed unlock instruction for period {}", input.lock_period);
    Ok(())
}
