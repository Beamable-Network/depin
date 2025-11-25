use solana_program::program_error::ProgramError;

pub enum DepinInstruction {
    SubmitWorkerProof = 1,
    InitNetwork = 2,
    ActivateWorker = 3,
    ActivateCheckerLicenses = 4,
    ActivateChecker = 6,
    Unlock = 7,
    PayoutCheckerRewards = 8,
    UpdateWorkerUri = 9,
    SetBMBState = 10,
    SetTreasuryConfig = 11,
    ViewCheckerReward = 12,
    FlexLock = 13,
    FlexUnlock = 14,
}

impl DepinInstruction {
    pub fn unpack(input: &[u8]) -> Result<Self, ProgramError> {
        let (&variant, _rest) = input
            .split_first()
            .ok_or(ProgramError::InvalidInstructionData)?;

        Ok(match variant {
            1 => Self::SubmitWorkerProof,
            2 => Self::InitNetwork,
            3 => Self::ActivateWorker,
            4 => Self::ActivateCheckerLicenses,
            6 => Self::ActivateChecker,
            7 => Self::Unlock,
            8 => Self::PayoutCheckerRewards,
            9 => Self::UpdateWorkerUri,
            10 => Self::SetBMBState,
            11 => Self::SetTreasuryConfig,
            12 => Self::ViewCheckerReward,
            13 => Self::FlexLock,
            14 => Self::FlexUnlock,
            _ => return Err(ProgramError::InvalidInstructionData),
        })
    }
}