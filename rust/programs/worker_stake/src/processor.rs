use borsh::BorshDeserialize;
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, msg, program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::{
    instruction::{
        WorkerStakeInstruction,
        InitializeWorkerStakeConfigParams,
        UpdateWorkerWalletParams,
        UpdateMinStakeRequirementParams,
        SetMonthlyPoolParams,
        WorkerStakeParams,
        WorkerUnstakeParams,
        ClaimRewardsParams,
        DepositRevenueParams,
        DepositEmissionsParams,
    },
    instructions::{
        admin::{
            process_initialize_worker_stake_config,
            process_update_min_stake_requirement,
        },
        worker::{
            process_worker_stake,
            process_worker_unstake,
            process_update_worker_wallet,
            process_set_monthly_pool,
        },
        user::{
            process_stake,
            process_unstake,
            process_withdraw,
            process_claim_rewards,
        },
        deposits::{
            process_deposit_revenue,
            process_deposit_emissions,
        },
    },
};

pub fn process<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = WorkerStakeInstruction::unpack(instruction_data)?;
    let data = &instruction_data[1..];

    match instruction {
        WorkerStakeInstruction::InitializeWorkerStakeConfig => {
            msg!("Instruction: InitializeWorkerStakeConfig");
            let params = InitializeWorkerStakeConfigParams::try_from_slice(data)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            process_initialize_worker_stake_config(
                program_id,
                accounts,
                params.worker_collection,
                params.worker_wallet,
                params.min_stake_requirement
            )
        }
        WorkerStakeInstruction::UpdateWorkerWallet => {
            msg!("Instruction: UpdateWorkerWallet");
            let params = UpdateWorkerWalletParams::try_from_slice(data)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            process_update_worker_wallet(program_id, accounts, params.new_worker_wallet)
        }
        WorkerStakeInstruction::UpdateMinStakeRequirement => {
            msg!("Instruction: UpdateMinStakeRequirement");
            let params = UpdateMinStakeRequirementParams::try_from_slice(data)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            process_update_min_stake_requirement(program_id, accounts, params.worker_collection, params.new_min_stake_requirement)
        }
        WorkerStakeInstruction::SetMonthlyPool => {
            msg!("Instruction: SetMonthlyPool");
            let params = SetMonthlyPoolParams::try_from_slice(data)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            process_set_monthly_pool(program_id, accounts, params.pools)
        }
        WorkerStakeInstruction::WorkerStake => {
            msg!("Instruction: WorkerStake");
            let params = WorkerStakeParams::try_from_slice(data)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            process_worker_stake(program_id, accounts, params.amount)
        }
        WorkerStakeInstruction::WorkerUnstake => {
            msg!("Instruction: WorkerUnstake");
            let params = WorkerUnstakeParams::try_from_slice(data)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            process_worker_unstake(program_id, accounts, params.amount)
        }
        WorkerStakeInstruction::Stake => {
            msg!("Instruction: Stake");
            process_stake(program_id, accounts, data)
        }
        WorkerStakeInstruction::Unstake => {
            msg!("Instruction: Unstake");
            process_unstake(program_id, accounts)
        }
        WorkerStakeInstruction::Withdraw => {
            msg!("Instruction: Withdraw");
            process_withdraw(program_id, accounts)
        }
        WorkerStakeInstruction::ClaimRewards => {
            msg!("Instruction: ClaimRewards");
            let params = ClaimRewardsParams::try_from_slice(data)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            process_claim_rewards(program_id, accounts, params.month_period)
        }
        WorkerStakeInstruction::DepositRevenue => {
            msg!("Instruction: DepositRevenue");
            let params = DepositRevenueParams::try_from_slice(data)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            process_deposit_revenue(program_id, accounts, params.worker_collection, params.total_revenue)
        }
        WorkerStakeInstruction::DepositEmissions => {
            msg!("Instruction: DepositEmissions");
            let params = DepositEmissionsParams::try_from_slice(data)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            process_deposit_emissions(program_id, accounts, params.month_period, params.amount)
        }
    }
}
