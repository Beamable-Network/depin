use crate::instructions::{
    admin::{process_activate_checker_licenses, process_init_network, process_set_bmb_state, process_set_checker_rewards_vault}, checker::{self, activate::process_activate_checker}, flexlock::{lock::process_flex_lock, unlock::process_flex_unlock}, view::process_view_checker_reward, worker::{process_activate_worker, process_submit_worker_proof, process_update_worker_uri}
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
        DepinInstruction::PayoutCheckerRewards => {
            checker::payout::process_payout_checker_rewards(program_id, accounts, data)?;
        },
        DepinInstruction::UpdateWorkerUri => {
            process_update_worker_uri(program_id, accounts, data)?;
        },
        DepinInstruction::SetBMBState => {
            process_set_bmb_state(program_id, accounts, data)?;
        },
        DepinInstruction::SetCheckerRewardsVault => {
            process_set_checker_rewards_vault(program_id, accounts, data)?;
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
