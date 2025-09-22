use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct LicenseMetadataV1 {
    pub version: u8,
    pub delegate: Option<Pubkey>
}

impl LicenseMetadataV1 {
    pub const LEN: usize = 1 + 1 + 1 + 32; // discriminator (u8) + version (u8) + Option tag (u8) + Pubkey (32)
}