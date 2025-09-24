use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;
use crate::{constants::seeds::{LICENSE_SEED, METADATA_SEED, PROOF_SEED, WORKER_SEED}, types::account::DepinAccountType};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct WorkerLicenseMetadata {
    pub suspended_at: Option<u64>
}

impl WorkerLicenseMetadata {
    pub const LEN: usize = 1 + 1 + 8;
    
    pub fn account_type() -> DepinAccountType {
        DepinAccountType::WorkerLicenseMetadata
    }

    pub fn find_pda(program_id: &Pubkey, worker_license: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[WORKER_SEED, LICENSE_SEED, worker_license.as_ref()], program_id)
    }
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct WorkerMetadata {
    pub suspended_at: Option<u64>,
    pub delegated_to: Pubkey,
    pub license: Pubkey,
    pub discovery_uri: String
}

impl WorkerMetadata {
    const BASE_SIZE: usize = 1 + 9 + 32 + 32 + 4;
    
    pub fn len(&self) -> usize {
        Self::BASE_SIZE + self.discovery_uri.len()
    }
    
    pub fn find_pda(program_id: &Pubkey, worker_license: &Pubkey, worker: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[WORKER_SEED, METADATA_SEED, worker_license.as_ref(), worker.as_ref()], program_id)
    }
    
    pub fn account_type() -> DepinAccountType {
        DepinAccountType::WorkerMetadata
    }
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct WorkerProof {
    pub period: u16,
    pub proof_root: [u8; 32],
    pub checkers: [u64; 8],
    pub uptime: u32,
    pub latency: u32
}

impl WorkerProof {
    pub const LEN: usize = 1 + 2 + 32 + 64 + 4 + 4;

    pub fn find_pda(program_id: &Pubkey, worker_license: &Pubkey, period: u16) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[PROOF_SEED, &period.to_le_bytes(), worker_license.as_ref()], program_id)
    }
    
    pub fn account_type() -> DepinAccountType {
        DepinAccountType::WorkerProof
    }
}