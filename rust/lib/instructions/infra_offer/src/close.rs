// use shared::utils::account::{write_account_data, read_account_data};
// use shared::types::account::DepinAccountType;
// use solana_program::{
//     account_info::{next_account_info, AccountInfo},
//     entrypoint::ProgramResult,
//     msg,
//     program_error::ProgramError,
//     pubkey::Pubkey,
// };

// use crate::state;

// pub fn process_close_infra_offer(
//     program_id: &Pubkey,
//     accounts: &[AccountInfo],
//     _instruction_data: &[u8],
// ) -> ProgramResult {
//     // Expected Accounts:
//     // 0. [signer] Provider
//     // 1. [writable] Offer account (must be owned by the program)
//     let account_info_iter = &mut accounts.iter();
//     let provider_account = next_account_info(account_info_iter)?;
//     let offer_account = next_account_info(account_info_iter)?;

//     if !provider_account.is_signer {
//         msg!("Error: Provider must sign the transaction");
//         return Err(ProgramError::MissingRequiredSignature);
//     }

//     if offer_account.owner != program_id {
//         msg!("Error: Offer account is not owned by the program");
//         return Err(ProgramError::IncorrectProgramId);
//     }

//     if !offer_account.is_writable {
//         msg!("Error: Offer account must be writable");
//         return Err(ProgramError::InvalidAccountData);
//     }

//     let mut data = offer_account.try_borrow_mut_data()?;

//     let mut offer: state::InfraOffer = read_account_data(&data, DepinAccountType::InfraOffer)?;

//     if offer.provider != *provider_account.key {
//         msg!("Error: Only the provider can close the offer");
//         return Err(ProgramError::IllegalOwner);
//     }

//     offer.is_active = false;

//     write_account_data(&mut data, DepinAccountType::InfraOffer, &offer)?;

//     Ok(())
// }