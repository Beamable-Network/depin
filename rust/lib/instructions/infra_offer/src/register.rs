// use borsh::BorshDeserialize;
// use shared::utils::account::write_account_data;
// use shared::types::account::DepinAccountType;
// use solana_program::{
//     account_info::{next_account_info, AccountInfo},
//     entrypoint::ProgramResult,
//     msg,
//     program_error::ProgramError,
//     pubkey::Pubkey,
// };

// use crate::state;

// pub fn process_register_infra_offer(
//     program_id: &Pubkey,
//     accounts: &[AccountInfo],
//     instruction_data: &[u8],
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

//     let input = state::InfraOfferInput::try_from_slice(instruction_data)?;

//     let offer = state::InfraOffer {
//         provider: *provider_account.key,
//         name: input.name,
//         description: input.description,
//         cpu: input.cpu,
//         memory: input.memory,
//         price: input.price,
//         is_active: true,
//     };

//     let mut data = offer_account.try_borrow_mut_data()?;

//     if data[0] > 0 {
//         msg!("Error: Offer account is already initialized");
//         return Err(ProgramError::AccountAlreadyInitialized);
//     }

//     write_account_data(&mut data, DepinAccountType::InfraOffer, &offer)?;
//     Ok(())
// }