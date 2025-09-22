use borsh::{BorshDeserialize, BorshSerialize};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct ActivateCheckersInput {
    pub period: u16,
    pub checker_count: u32,
}
