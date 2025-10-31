use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    msg,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
};

/// Creates an Associated Token Account (ATA) if it doesn't exist.
/// Uses the idempotent create instruction, so it's safe to call even if the ATA already exists.
///
/// # Arguments
/// * `payer` - The account that will pay for the ATA creation
/// * `wallet` - The wallet that will own the ATA
/// * `mint` - The token mint for the ATA
/// * `ata_account` - The ATA account info (should be at the derived ATA address)
/// * `token_program` - The SPL token program
/// * `associated_token_program` - The SPL associated token program
///
/// # Returns
/// * `Ok(())` if the ATA was created or already exists
/// * `Err(ProgramError)` if creation failed
///
/// # Example
/// ```ignore
/// initialize_ata_if_needed(
///     payer_account,
///     wallet_account,
///     mint_account,
///     ata_account,
///     token_program,
///     associated_token_program,
/// )?;
/// ```
pub fn initialize_ata_if_needed<'a>(
    payer: &AccountInfo<'a>,
    wallet: &AccountInfo<'a>,
    mint: &AccountInfo<'a>,
    ata_account: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    associated_token_program: &AccountInfo<'a>,
    system_program: &AccountInfo<'a>,
) -> ProgramResult {
    // Verify the provided ATA account matches the expected derived address
    let expected_ata = spl_associated_token_account::get_associated_token_address(
        wallet.key,
        mint.key,
    );

    if *ata_account.key != expected_ata {
        msg!("Error: ATA account does not match expected address");
        msg!("Expected: {}, Provided: {}", expected_ata, ata_account.key);
        return Err(ProgramError::InvalidArgument);
    }

    // Use idempotent create - safe to call even if ATA already exists
    let create_ata_ix = spl_associated_token_account::instruction::create_associated_token_account_idempotent(
        payer.key,
        wallet.key,
        mint.key,
        token_program.key,
    );

    invoke(
        &create_ata_ix,
        &[
            payer.clone(),
            ata_account.clone(),
            wallet.clone(),
            mint.clone(),
            system_program.clone(),
            token_program.clone(),
            associated_token_program.clone(),
        ],
    )?;

    Ok(())
}

/// Creates an Associated Token Account (ATA) with PDA signing if it doesn't exist.
/// Uses the idempotent create instruction, so it's safe to call even if the ATA already exists.
///
/// This is useful when the wallet is a PDA that needs to sign.
///
/// # Arguments
/// * `payer` - The account that will pay for the ATA creation
/// * `wallet` - The PDA wallet that will own the ATA
/// * `mint` - The token mint for the ATA
/// * `ata_account` - The ATA account info (should be at the derived ATA address)
/// * `token_program` - The SPL token program
/// * `associated_token_program` - The SPL associated token program
/// * `signer_seeds` - The seeds for PDA signing
///
/// # Returns
/// * `Ok(())` if the ATA was created or already exists
/// * `Err(ProgramError)` if creation failed
pub fn initialize_ata_if_needed_with_signer<'a>(
    payer: &AccountInfo<'a>,
    wallet: &AccountInfo<'a>,
    mint: &AccountInfo<'a>,
    ata_account: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    associated_token_program: &AccountInfo<'a>,
    system_program: &AccountInfo<'a>,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    // Verify the provided ATA account matches the expected derived address
    let expected_ata = spl_associated_token_account::get_associated_token_address(
        wallet.key,
        mint.key,
    );

    if *ata_account.key != expected_ata {
        msg!("Error: ATA account does not match expected address");
        msg!("Expected: {}, Provided: {}", expected_ata, ata_account.key);
        return Err(ProgramError::InvalidArgument);
    }

    // Use idempotent create - safe to call even if ATA already exists
    let create_ata_ix = spl_associated_token_account::instruction::create_associated_token_account_idempotent(
        payer.key,
        wallet.key,
        mint.key,
        token_program.key,
    );

    solana_program::program::invoke_signed(
        &create_ata_ix,
        &[
            payer.clone(),
            ata_account.clone(),
            wallet.clone(),
            mint.clone(),
            system_program.clone(),
            token_program.clone(),
            associated_token_program.clone(),
        ],
        &[signer_seeds],
    )?;

    Ok(())
}

/// Gets the Associated Token Account address for a wallet and mint.
///
/// # Arguments
/// * `wallet` - The wallet pubkey
/// * `mint` - The mint pubkey
///
/// # Returns
/// The ATA address
pub fn get_ata_address(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    spl_associated_token_account::get_associated_token_address(wallet, mint)
}
