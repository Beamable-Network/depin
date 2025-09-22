use global::process_activate_checker_licenses;
use worker::process_submit_worker_proof;
use worker::process_activate_worker;
use worker::process_update_worker_uri;
use init::process_init_network;
use treasury::unlock::process_unlock;
use checker::activate::process_activate_checker;
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

use crate::instruction::DepinInstruction;

pub fn process<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction: DepinInstruction = DepinInstruction::unpack(instruction_data)?;
    let data = &instruction_data[1..];
    match instruction {
        DepinInstruction::SubmitWorkerProof => {
            process_submit_worker_proof(program_id, accounts, data)?;
        }
        DepinInstruction::InitNetwork => {
            process_init_network(program_id, accounts, data)?;
        },
        DepinInstruction::ActivateWorker => {
            process_activate_worker(program_id, accounts, data)?;
        },
        DepinInstruction::ActivateCheckerLicenses => {
            process_activate_checker_licenses(program_id, accounts, data)?;
        },
        DepinInstruction::ActivateChecker => {
            process_activate_checker(program_id, accounts, data)?;
        },
        DepinInstruction::Unlock => {
            process_unlock(program_id, accounts, data)?;
        },
        DepinInstruction::PayoutCheckerRewards => {
            checker::payout::process_payout_checker_rewards(program_id, accounts, data)?;
        },
        DepinInstruction::UpdateWorkerUri => {
            process_update_worker_uri(program_id, accounts, data)?;
        }
    }
    Ok(())
}