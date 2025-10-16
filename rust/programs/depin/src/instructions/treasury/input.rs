use borsh::{BorshDeserialize, BorshSerialize};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct UnlockInput {
    pub lock_period: u16,  // The period when the tokens were locked
}