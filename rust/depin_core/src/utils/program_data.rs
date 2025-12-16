use solana_program::{
    account_info::AccountInfo,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use solana_loader_v3_interface::state::UpgradeableLoaderState;

use crate::{constants::BPF_LOADER_UPGRADEABLE_PROGRAM, utils::validation::validate_pda_account};

/// Validates the upgrade authority from a ProgramData account.
///
/// This function extracts the upgrade authority from a BPF Loader Upgradeable
/// ProgramData account by manually parsing the account data at known offsets,
/// avoiding the need for bincode deserialization.
///
/// # ProgramData Account Layout (bincode serialized)
/// - Offset 0-3: discriminator (u32, value = 3 for ProgramData variant)
/// - Offset 4-11: slot (u64)
/// - Offset 12: Option discriminator (0 = None, 1 = Some)
/// - Offset 13-44: upgrade_authority Pubkey (32 bytes, if Option is Some)
///
/// # Arguments
/// * `program_id` - The program ID whose upgrade authority we're checking
/// * `program_data_account` - The ProgramData account to validate
/// * `expected_authority` - The pubkey that should match the upgrade authority
///
/// # Returns
/// * `Ok(())` if validation succeeds
/// * `Err(ProgramError)` if validation fails
///
/// # Errors
/// * `InvalidArgument` - If program_data_account doesn't match expected PDA
/// * `InvalidAccountData` - If account data is malformed
/// * `Immutable` - If program has no upgrade authority
/// * `InvalidArgument` - If expected_authority doesn't match actual authority
pub fn validate_upgrade_authority(
    program_id: &Pubkey,
    program_data_account: &AccountInfo,
    actual_authority_account: &AccountInfo,
) -> Result<(), ProgramError> {
    if !actual_authority_account.is_signer {
        msg!("Error: Program upgrade authority must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate ProgramData account matches expected PDA
    let (expected_program_data, _bump) = Pubkey::find_program_address(
        &[program_id.as_ref()],
        &BPF_LOADER_UPGRADEABLE_PROGRAM
    );
    validate_pda_account(program_data_account, &expected_program_data, "ProgramData")?;

    // Extract upgrade authority from ProgramData account
    let authority = extract_upgrade_authority(program_data_account)?;

    // Validate expected authority matches actual authority
    if actual_authority_account.key != &authority {
        msg!("Error: Expected authority does not match program upgrade authority");
        return Err(ProgramError::InvalidArgument);
    }

    Ok(())
}

/// Extracts the upgrade authority pubkey from a ProgramData account.
///
/// This function manually parses the ProgramData account data at known offsets
/// to extract the upgrade authority without requiring bincode deserialization.
///
/// # Arguments
/// * `program_data_account` - The ProgramData account to parse
///
/// # Returns
/// * `Ok(Pubkey)` - The upgrade authority pubkey
/// * `Err(ProgramError)` - If parsing fails or program has no authority
pub fn extract_upgrade_authority(
    program_data_account: &AccountInfo,
) -> Result<Pubkey, ProgramError> {
    let program_data = program_data_account.try_borrow_data()?;

    // Validate minimum size
    if program_data.len() < UpgradeableLoaderState::size_of_programdata_metadata() {
        msg!("Error: ProgramData account too small");
        return Err(ProgramError::InvalidAccountData);
    }

    // Check discriminator (should be 3 for ProgramData variant)
    let discriminator = u32::from_le_bytes(
        program_data[0..4]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?
    );
    if discriminator != 3 {
        msg!("Error: Invalid ProgramData discriminator, expected 3, got {}", discriminator);
        return Err(ProgramError::InvalidAccountData);
    }

    // Check Option discriminator at offset 12 (after 4-byte discriminator + 8-byte slot)
    let option_discriminator = program_data[12];
    if option_discriminator == 0 {
        msg!("Error: Program has no upgrade authority");
        return Err(ProgramError::Immutable);
    } else if option_discriminator != 1 {
        msg!("Error: Invalid Option discriminator in ProgramData, expected 0 or 1, got {}", option_discriminator);
        return Err(ProgramError::InvalidAccountData);
    }

    // Extract upgrade authority pubkey at offset 13
    let authority_bytes = &program_data[13..45];
    let authority = Pubkey::try_from(authority_bytes)
        .map_err(|_| {
            msg!("Error: Failed to parse upgrade authority pubkey");
            ProgramError::InvalidAccountData
        })?;

    Ok(authority)
}
