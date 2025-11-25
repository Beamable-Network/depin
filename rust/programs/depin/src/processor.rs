use crate::instructions::{
    checker::{self, activate::process_activate_checker},
    admin::process_activate_checker_licenses,
    admin::process_init_network,
    admin::process_set_bmb_state,
    admin::process_set_treasury_config,
    treasury::unlock::process_unlock,
    view::process_view_checker_reward,
    worker::{process_activate_worker, process_submit_worker_proof, process_update_worker_uri},
    flexlock::{flex_lock::process_flex_lock, flex_unlock::process_flex_unlock},
};
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
        },
        DepinInstruction::SetBMBState => {
            process_set_bmb_state(program_id, accounts, data)?;
        },
        DepinInstruction::SetTreasuryConfig => {
            process_set_treasury_config(program_id, accounts, data)?;
        },
        DepinInstruction::ViewCheckerReward => {
            process_view_checker_reward(program_id, accounts, data)?;
        },
        DepinInstruction::FlexLock => {
            process_flex_lock(program_id, accounts, data)?;
        },
        DepinInstruction::FlexUnlock => {
            process_flex_unlock(program_id, accounts, data)?;
        }
    }
    Ok(())
}
