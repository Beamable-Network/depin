use borsh::BorshDeserialize;
use shared::types::account::DepinAccountType;
use shared::utils::account::read_account_data;
use shared::{constants::seeds::METADATA_SEED, utils::account::write_account_data};
use solana_program::program::invoke_signed;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use solana_program::{
    system_instruction,
    sysvar::{rent::Rent, Sysvar},
};

use crate::input;
use crate::state::{self, LicenseMetadataV1};

pub fn process_delegate_license(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] License owner
    // 1. [writable] License metadata account (PDA, address calculated by client)
    // 2. [] License mint account
    // 3. [] System program account (for account creation if needed)

    let account_info_iter = &mut accounts.iter();
    let owner_account = next_account_info(account_info_iter)?;
    let license_metadata_account = next_account_info(account_info_iter)?;
    let license_mint_account = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    if !owner_account.is_signer {
        msg!("Error: Owner must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate License metadata PDA
    let (pda, bump_seed) = Pubkey::find_program_address(
        &[
            METADATA_SEED,
            owner_account.key.as_ref(),
            license_mint_account.key.as_ref(),
        ],
        program_id,
    );

    if *license_metadata_account.key != pda {
        msg!("Error: License metadata account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    let input = input::DelegateLicenseInput::try_from_slice(instruction_data)?;

    if license_metadata_account.data_is_empty() {
        msg!("Initializing license metadata account at address: {}", pda);
        // Calculate rent-exempt minimum balance
        let rent = Rent::get()?;
        let space = LicenseMetadataV1::LEN;
        let rent_lamports = rent.minimum_balance(space);

        // Create the token account
        invoke_signed(
            &system_instruction::create_account(
                owner_account.key,
                license_metadata_account.key,
                rent_lamports,
                space as u64,
                &program_id,
            ),
            &[
                owner_account.clone(),
                license_metadata_account.clone(),
                system_program.clone(),
            ],
            &[&[
                METADATA_SEED,
                owner_account.key.as_ref(),
                license_mint_account.key.as_ref(),
                &[bump_seed],
            ]],
        )?;

        let metadata = LicenseMetadataV1 {
            version: 1,
            delegate: input.delegate,
        };

        let mut data = license_metadata_account.try_borrow_mut_data()?;
        write_account_data(&mut data, DepinAccountType::LicenseMetadata, &metadata)?;
    } else {
        let mut data = license_metadata_account.try_borrow_mut_data()?;

        if data.len() < 2 {
            msg!("Error: License metadata account data is too small");
            return Err(ProgramError::InvalidAccountData);
        }

        let version = data[1];

        if version == 1 {
            let mut metadata: state::LicenseMetadataV1 =
                read_account_data(&data, DepinAccountType::LicenseMetadata)?;
            metadata.delegate = input.delegate;
            write_account_data(&mut data, DepinAccountType::LicenseMetadata, &metadata)?;
        } else {
            msg!("Error: Unsupported license metadata version");
            return Err(ProgramError::InvalidAccountData);
        }
    }

    Ok(())
}
