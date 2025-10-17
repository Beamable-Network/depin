use solana_program::program_error::ProgramError;

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

impl RevShareInstruction {
    pub fn unpack(input: &[u8]) -> Result<Self, ProgramError> {
        let (&variant, _rest) = input
            .split_first()
            .ok_or(ProgramError::InvalidInstructionData)?;

        Ok(match variant {
            1 => Self::InitializeOffer,
            2 => Self::Stake,
            3 => Self::AddStake,
            4 => Self::OptOutRollover,
            5 => Self::Unstake,
            6 => Self::ClaimRewards,
            7 => Self::DepositRevenue,
            _ => return Err(ProgramError::InvalidInstructionData),
        })
    }
}
