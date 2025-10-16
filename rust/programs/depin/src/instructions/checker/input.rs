use borsh::{BorshDeserialize, BorshSerialize};
use crate::shared::features::bubblegum::cnft_context::CnftContext;
use solana_program::pubkey::Pubkey;

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct ActivateCheckerInput {
    pub license_context: CnftContext,
    pub delegated_to: Pubkey
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct PayoutCheckerRewardsInput {
    pub license_context: CnftContext,
}