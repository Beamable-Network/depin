use borsh::BorshSerialize;
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, instruction::{AccountMeta, Instruction}, program::invoke, msg, program_error::ProgramError};

use crate::{constants::programs::MPL_ACCOUNT_COMPRESSION_PROGRAM, features::bubblegum::cnft_context::CnftContext};

#[derive(BorshSerialize)]
struct VerifyLeafData {
    root: [u8; 32],
    leaf: [u8; 32],
    index: u32,
}

pub fn verify_license<'a>(
    merkle_tree_account: &AccountInfo<'a>,
    proof_accounts: &[AccountInfo<'a>],
    root: [u8; 32],
    leaf_hash: [u8; 32],
    index: u32,
) -> ProgramResult {
    const VERIFY_LEAF_DISCRIMINATOR: [u8; 8] = [124, 220, 22, 223, 104, 10, 250, 224];
    
    let args = VerifyLeafData {
        root,
        leaf: leaf_hash,
        index,
    };
    
    let serialized_args = borsh::to_vec(&args)?;
    
    let mut instruction_data = Vec::with_capacity(VERIFY_LEAF_DISCRIMINATOR.len() + serialized_args.len());
    instruction_data.extend_from_slice(&VERIFY_LEAF_DISCRIMINATOR);
    instruction_data.extend_from_slice(&serialized_args);

    let mut invoke_accounts = Vec::with_capacity(1 + proof_accounts.len());
    invoke_accounts.push(merkle_tree_account.clone());
    invoke_accounts.extend_from_slice(proof_accounts);

    let accounts_meta: Vec<AccountMeta> = invoke_accounts
        .iter()
        .map(|account| AccountMeta::new_readonly(*account.key, false))
        .collect();

    let instruction = Instruction {
        program_id: MPL_ACCOUNT_COMPRESSION_PROGRAM,
        accounts: accounts_meta,
        data: instruction_data,
    };

    invoke(&instruction, &invoke_accounts)
}

pub fn verify_license_and_owner<'a>(
    merkle_tree_account: &AccountInfo<'a>,
    proof_accounts: &[AccountInfo<'a>],
    license: &CnftContext,
    leaf_hash: [u8; 32],
    license_owner_account: &AccountInfo<'a>,
) -> ProgramResult {
    // Check that the license owner account matches the license owner
    if *license_owner_account.key != license.owner {
        msg!("Error: License owner account must be the owner of the cNFT license");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Check that the license owner is a signer
    if !license_owner_account.is_signer {
        msg!("Error: License owner must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Call the original verify_license function
    verify_license(
        merkle_tree_account,
        proof_accounts,
        license.root,
        leaf_hash,
        license.index,
    )
}