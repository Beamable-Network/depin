use borsh::{BorshDeserialize, BorshSerialize};
use shared::features::bubblegum::cnft_context::CnftContext;
use solana_program::pubkey::Pubkey;

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct SubmitWorkerProofInput {
    pub license_context: CnftContext,
    pub proof_root: [u8; 32],
    pub period: u16,
    pub checkers: [u64; 8],
    pub uptime: u32,
    pub latency: u32
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct ActivateWorkerInput {
    pub license_context: CnftContext,
    pub delegated_to: Pubkey,
    pub discovery_uri: String,
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct UpdateWorkerUriInput {
    pub license_context: CnftContext,
    pub discovery_uri: String,
}