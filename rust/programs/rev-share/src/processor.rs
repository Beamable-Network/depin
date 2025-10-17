use borsh::BorshDeserialize;
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, msg, program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::{
    instruction::RevShareInstruction,
    instructions::*,
};

pub fn process<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = RevShareInstruction::try_from_slice(instruction_data)
        .map_err(|_| {
            msg!("Error: Failed to deserialize instruction");
            ProgramError::InvalidInstructionData
        })?;

    match instruction {
        RevShareInstruction::InitializeOffer => {
            msg!("Instruction: InitializeOffer");
            process_initialize_offer(program_id, accounts, &instruction_data[1..])?;
        }
        RevShareInstruction::Stake => {
            msg!("Instruction: Stake");
            process_stake(program_id, accounts, &instruction_data[1..])?;
        }
        RevShareInstruction::AddStake => {
            msg!("Instruction: AddStake");
            process_add_stake(program_id, accounts, &instruction_data[1..])?;
        }
        RevShareInstruction::OptOutRollover => {
            msg!("Instruction: OptOutRollover");
            process_opt_out_rollover(program_id, accounts, &instruction_data[1..])?;
        }
        RevShareInstruction::Unstake => {
            msg!("Instruction: Unstake");
            process_unstake(program_id, accounts, &instruction_data[1..])?;
        }
        RevShareInstruction::ClaimRewards => {
            msg!("Instruction: ClaimRewards");
            process_claim_rewards(program_id, accounts, &instruction_data[1..])?;
        }
        RevShareInstruction::DepositRevenue => {
            msg!("Instruction: DepositRevenue");
            process_deposit_revenue(program_id, accounts, &instruction_data[1..])?;
        }
    }

    Ok(())
}
