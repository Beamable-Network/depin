use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

/// Validates that an account matches the expected PDA address
///
/// # Arguments
/// * `account` - The account to validate
/// * `expected_pda` - The expected PDA address
/// * `account_name` - Human-readable name for error messages
///
/// # Returns
/// * `Ok(())` if validation passes
/// * `Err(ProgramError::InvalidArgument)` if validation fails
pub fn validate_pda_account<'a>(
    account: &AccountInfo<'a>,
    expected_pda: &Pubkey,
    account_name: &str,
) -> ProgramResult {
    if account.key != expected_pda {
        msg!("Error: {} account does not match expected PDA", account_name);
        return Err(ProgramError::InvalidArgument);
    }
    Ok(())
}

/// Validates that an ATA (Associated Token Account) matches the expected address
///
/// # Arguments
/// * `ata_account` - The ATA account to validate
/// * `owner` - The owner of the ATA
/// * `mint` - The token mint
/// * `token_name` - Human-readable token name for error messages
///
/// # Returns
/// * `Ok(())` if validation passes
/// * `Err(ProgramError::InvalidArgument)` if validation fails
pub fn validate_ata_account<'a>(
    ata_account: &AccountInfo<'a>,
    owner: &Pubkey,
    mint: &Pubkey,
    token_name: &str,
) -> ProgramResult {
    let expected_ata = spl_associated_token_account::get_associated_token_address(
        owner,
        mint,
    );
    if *ata_account.key != expected_ata {
        msg!("Error: {} ATA does not match expected address", token_name);
        return Err(ProgramError::InvalidArgument);
    }
    Ok(())
}

/// Validates that a mint account matches the expected mint address
///
/// # Arguments
/// * `mint_account` - The mint account to validate
/// * `expected_mint` - The expected mint address
/// * `mint_name` - Human-readable mint name for error messages
///
/// # Returns
/// * `Ok(())` if validation passes
/// * `Err(ProgramError::InvalidArgument)` if validation fails
pub fn validate_mint<'a>(
    mint_account: &AccountInfo<'a>,
    expected_mint: &Pubkey,
    mint_name: &str,
) -> ProgramResult {
    if mint_account.key != expected_mint {
        msg!("Error: Invalid {} mint", mint_name);
        return Err(ProgramError::InvalidArgument);
    }
    Ok(())
}

/// Validates that an account has signed the transaction
///
/// # Arguments
/// * `account` - The account to check for signature
/// * `account_name` - Human-readable name for error messages
///
/// # Returns
/// * `Ok(())` if account is a signer
/// * `Err(ProgramError::MissingRequiredSignature)` if account is not a signer
pub fn require_signer<'a>(
    account: &AccountInfo<'a>,
    account_name: &str,
) -> ProgramResult {
    if !account.is_signer {
        msg!("Error: {} must sign the transaction", account_name);
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}
