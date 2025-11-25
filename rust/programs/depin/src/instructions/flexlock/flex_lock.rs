use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    pubkey::Pubkey,
};
use crate::shared::features::flexlock::utils::lock as lock_tokens;

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct FlexLockInput {
    pub receiver: Pubkey,
    pub amount: u64,
    pub lock_duration_days: u16,
}

pub fn process_flex_lock<'info>(
    program_id: &Pubkey,
    accounts: &'info [AccountInfo<'info>],
    instruction_data: &[u8],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Sender account (must sign to lock their tokens)
    // 1. [writable] Sender's BMB token account (ATA)
    // 2. [writable] FlexlockTokens PDA account
    // 3. [writable] Flexlock vault ATA account (vault authority's associated token account)
    // 4. [readonly] BMB mint account
    // 5. [readonly] Token program
    // 6. [readonly] System program

    let account_info_iter = &mut accounts.iter();
    let sender_account = next_account_info(account_info_iter)?;
    let sender_ata_account = next_account_info(account_info_iter)?;
    let flexlock_tokens_account = next_account_info(account_info_iter)?;
    let flexlock_vault_ata_account = next_account_info(account_info_iter)?;
    let bmb_mint_account = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    let input = FlexLockInput::try_from_slice(instruction_data)?;

    lock_tokens(
        program_id,
        &input.receiver,
        input.amount,
        input.lock_duration_days,
        sender_account,
        sender_ata_account,
        flexlock_tokens_account,
        flexlock_vault_ata_account,
        bmb_mint_account,
        token_program,
        system_program,
    )?;

    Ok(())
}
