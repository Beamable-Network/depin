use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    pubkey::Pubkey,
};
use crate::shared::features::flexlock::utils::unlock as unlock_tokens;

pub fn process_flex_unlock<'info>(
    program_id: &Pubkey,
    accounts: &'info [AccountInfo<'info>],
    _instruction_data: &[u8],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Receiver account (must be the receiver of the locked tokens)
    // 1. [writable] Sender account (original sender of the locked tokens)
    // 2. [writable] FlexlockTokens PDA account
    // 3. [writable] Flexlock vault ATA account
    // 4. [readonly] Flexlock vault authority PDA account
    // 5. [writable] Receiver's BMB token account (ATA) - where vested tokens will be sent
    // 6. [writable] Sender's BMB token account (ATA) - where penalty will be returned
    // 7. [readonly] BMB mint account
    // 8. [readonly] Token program
    // 9. [writable] Rent receiver account (receives rent when FlexlockTokens account is closed)

    let account_info_iter = &mut accounts.iter();
    let receiver_account = next_account_info(account_info_iter)?;
    let sender_account = next_account_info(account_info_iter)?;
    let flexlock_tokens_account = next_account_info(account_info_iter)?;
    let flexlock_vault_ata_account = next_account_info(account_info_iter)?;
    let flexlock_vault_authority_account = next_account_info(account_info_iter)?;
    let receiver_ata_account = next_account_info(account_info_iter)?;
    let sender_ata_account = next_account_info(account_info_iter)?;
    let rent_receiver_account = next_account_info(account_info_iter)?;
    let bmb_mint_account = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;

    unlock_tokens(
        program_id,
        receiver_account,
        sender_account,
        flexlock_tokens_account,
        flexlock_vault_ata_account,
        flexlock_vault_authority_account,
        receiver_ata_account,
        sender_ata_account,
        bmb_mint_account,
        token_program,
        rent_receiver_account,
    )?;

    Ok(())
}
