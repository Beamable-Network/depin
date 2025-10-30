use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{program_error::ProgramError, pubkey::Pubkey};
use depin_core::utils::cnft_context::CnftContext;

// Parameter structs with Borsh serialization
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct InitializeWorkerStakeConfigParams {
    pub worker_collection: Pubkey,
    pub worker_wallet: Pubkey,
    pub min_stake_requirement: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct UpdateWorkerWalletParams {
    pub new_worker_wallet: Pubkey,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct UpdateMinStakeRequirementParams {
    pub worker_collection: Pubkey,
    pub new_min_stake_requirement: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct SetMonthlyPoolParams {
    pub pools: Vec<MonthlyPoolConfig>,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct WorkerStakeParams {
    pub amount: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct WorkerUnstakeParams {
    pub amount: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct StakeParams {
    pub amount: u64,
    pub checker_count: u16,
    pub license_context: CnftContext,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct ClaimRewardsParams {
    pub month_period: u16,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct DepositRevenueParams {
    pub worker_collection: Pubkey,
    pub total_revenue: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct DepositEmissionsParams {
    pub month_period: u16,
    pub amount: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct MonthlyPoolConfig {
    pub month_period: u16,
    pub base_revenue_percentage: u16,
    pub addon_revenue_percentage: u16,
    pub base_emission_percentage: u16,
}

// Instruction enum with explicit discriminants
pub enum WorkerStakeInstruction {
    // Admin instructions
    InitializeWorkerStakeConfig = 1,
    UpdateWorkerWallet = 2,
    UpdateMinStakeRequirement = 3,
    SetMonthlyPool = 4,

    // Worker instructions
    WorkerStake = 5,
    WorkerUnstake = 6,

    // User instructions
    Stake = 7,
    Unstake = 8,
    Withdraw = 9,
    ClaimRewards = 10,

    // Deposit instructions
    DepositRevenue = 11,
    DepositEmissions = 12,
}

impl WorkerStakeInstruction {
    pub fn unpack(input: &[u8]) -> Result<Self, ProgramError> {
        let (&variant, _rest) = input
            .split_first()
            .ok_or(ProgramError::InvalidInstructionData)?;

        Ok(match variant {
            1 => Self::InitializeWorkerStakeConfig,
            2 => Self::UpdateWorkerWallet,
            3 => Self::UpdateMinStakeRequirement,
            4 => Self::SetMonthlyPool,
            5 => Self::WorkerStake,
            6 => Self::WorkerUnstake,
            7 => Self::Stake,
            8 => Self::Unstake,
            9 => Self::Withdraw,
            10 => Self::ClaimRewards,
            11 => Self::DepositRevenue,
            12 => Self::DepositEmissions,
            _ => return Err(ProgramError::InvalidInstructionData),
        })
    }
}
