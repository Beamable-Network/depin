use borsh::{BorshDeserialize, BorshSerialize};

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
#[borsh(use_discriminant = true)]
pub enum RevShareInstruction {
    /// Initialize a new revenue sharing offer
    /// Only callable by admin
    InitializeOffer = 1,

    /// Stake BMB tokens for the first time
    Stake = 2,

    /// Add more BMB to an existing stake
    AddStake = 3,

    /// Opt out of future auto-rollover
    OptOutRollover = 4,

    /// Unstake BMB tokens after opting out
    Unstake = 5,

    /// Claim USDC rewards from a completed offer
    ClaimRewards = 6,

    /// Deposit USDC revenue to the active offer
    /// Only callable by depin program (or admin in test mode)
    DepositRevenue = 7,
}
