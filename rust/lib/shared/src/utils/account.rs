use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    program_error::ProgramError, 
    msg,
    account_info::AccountInfo,
    sysvar::rent::Rent,
    system_instruction,
    program::invoke,
    entrypoint::ProgramResult,
};

use crate::{constants::accounts::DISC_SIZE, types::account::DepinAccountType};

pub fn write_account_data<T: BorshSerialize>(
    data: &mut [u8],
    discriminator: DepinAccountType,
    account_data: &T,
) -> Result<(), ProgramError> {
    if data.is_empty() {
        msg!("Error: account data buffer is empty");
        return Err(ProgramError::AccountDataTooSmall);
    }
    data[0] = discriminator as u8;
    account_data.serialize(&mut &mut data[DISC_SIZE..])?;
    Ok(())
}

pub fn read_account_data<'a, T: BorshDeserialize>(
    data: &'a [u8],
    expected_discriminator: DepinAccountType,
) -> Result<T, ProgramError> {
    if data.is_empty() {
        msg!("Error: account data buffer is empty");
        return Err(ProgramError::AccountDataTooSmall);
    }

    if data[0] != expected_discriminator as u8 {
        msg!(
            "Error: account type mismatch. Expected: {}, Found: {}",
            expected_discriminator as u8,
            data[0]
        );
        return Err(ProgramError::InvalidAccountData);
    }

    let mut data_slice = &data[DISC_SIZE..];
    let account_data = T::deserialize(&mut data_slice)
        .map_err(|e| {
            msg!("Error deserializing account data: {:?}", e);
            ProgramError::InvalidAccountData
        })?;

    Ok(account_data)
}

/// Reallocates an account to a new size and handles rent adjustments
/// 
/// # Arguments
/// * `payer` - The account that pays for additional rent or receives refunds
/// * `target_account` - The account to reallocate
/// * `system_program` - The system program account
/// * `rent` - The rent sysvar
/// * `required_space` - The new size for the account
pub fn reallocate_account_if_needed<'a>(
    payer: &'a AccountInfo<'a>,
    target_account: &'a AccountInfo<'a>,
    system_program: &'a AccountInfo<'a>,
    rent: &Rent,
    required_space: usize,
) -> ProgramResult {
    let current_space = target_account.data_len();
    
    if current_space != required_space {
        msg!("Reallocating account from {} to {} bytes", current_space, required_space);
        
        let current_rent = rent.minimum_balance(current_space);
        let required_rent = rent.minimum_balance(required_space);
        
        // Reallocate the account
        target_account.realloc(required_space, false)?;
        
        // Handle rent difference
        if required_rent > current_rent {
            // Need to add more lamports
            let additional_rent = required_rent - current_rent;
            msg!("Adding {} lamports for increased size", additional_rent);
            
            invoke(
                &system_instruction::transfer(
                    payer.key,
                    target_account.key,
                    additional_rent,
                ),
                &[payer.clone(), target_account.clone(), system_program.clone()],
            )?;
        } else if current_rent > required_rent {
            // Can refund excess lamports
            let excess_rent = current_rent - required_rent;
            msg!("Refunding {} lamports for decreased size", excess_rent);
            
            **target_account.try_borrow_mut_lamports()? -= excess_rent;
            **payer.try_borrow_mut_lamports()? += excess_rent;
        }
    }
    
    Ok(())
}