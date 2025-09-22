use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;
use crate::{constants::seeds::{CHECKER_SEED, LICENSE_SEED, METADATA_SEED}, types::account::DepinAccountType};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct CheckerMetadata {
    pub suspended_at: Option<u64>,
    pub delegated_to: Pubkey,
}

impl CheckerMetadata {
    pub const LEN: usize = 1 + 9 + 32;

    pub fn find_pda(program_id: &Pubkey, checker_license: &Pubkey, checker: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[CHECKER_SEED, METADATA_SEED, checker_license.as_ref(), checker.as_ref()], program_id)
    }

    pub fn account_type() -> DepinAccountType {
        DepinAccountType::CheckerMetadata
    }
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct CheckerLicenseMetadata {
    pub suspended_at: Option<u64>
}

impl CheckerLicenseMetadata {
    pub const LEN: usize = 1 + 9;

    pub fn find_pda(program_id: &Pubkey, checker_license: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[CHECKER_SEED, LICENSE_SEED, METADATA_SEED, checker_license.as_ref()], program_id)
    }
    
    pub fn account_type() -> DepinAccountType {
        DepinAccountType::CheckerLicenseMetadata
    }
}