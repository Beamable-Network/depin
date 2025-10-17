use borsh::{BorshDeserialize, BorshSerialize};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct InitializeOfferInput {
    pub offer_id: u32,
    pub start_time: i64,
    pub end_time: i64,
    pub revenue_percentage: u16,
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct StakeInput {
    pub amount: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct AddStakeInput {
    pub amount: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct ClaimRewardsInput {
    pub offer_id: u32,
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct DepositRevenueInput {
    pub amount: u64,
}

// OptOut and Unstake don't need input structs (no parameters)
