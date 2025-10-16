use solana_program::pubkey::Pubkey;
use borsh::{BorshDeserialize, BorshSerialize};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct InfraOffer {
    pub provider: Pubkey,
    pub cpu: u64,
    pub memory: u64,
    pub price: u64,
    pub is_active: bool,
    pub name: String,
    pub description: String,
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct InfraOfferInput {
    pub cpu: u64,
    pub memory: u64,
    pub price: u64,
    pub name: String,
    pub description: String,
}