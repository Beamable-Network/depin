use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;


#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct CnftContext {
    pub owner: Pubkey,
    pub delegate: Pubkey,
    pub nonce: u64,
    pub index: u32,
    pub root: [u8; 32],
    pub data_hash: [u8; 32],
    pub creator_hash: [u8; 32],
    pub collection: Option<Pubkey>,
    pub asset_data_hash: [u8; 32],
    pub flags: u8
}

impl CnftContext {
    pub fn get_collection_hash(&self) -> [u8; 32] {
        crate::shared::utils::bgum::hash_collection_option(self.collection)
    }
}