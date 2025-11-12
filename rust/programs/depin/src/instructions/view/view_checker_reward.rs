use crate::shared::{
    constants::seeds::{GLOBAL_SEED, STATE_SEED},
    features::{global::accounts::BMBState, rewards::accounts::GlobalRewards},
};
use borsh::{BorshDeserialize, BorshSerialize};
use depin_core::{
    types::account::DepinAccountType,
    utils::account::read_account_data,
};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::set_return_data,
    program_error::ProgramError,
    pubkey::Pubkey,
};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct ViewCheckerRewardInput {
    pub period: u16,
}

pub fn process_view_checker_reward<'info>(
    program_id: &Pubkey,
    accounts: &'info [AccountInfo<'info>],
    instruction_data: &[u8],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [readonly] BMBState PDA account
    let account_info_iter = &mut accounts.iter();
    let bmb_state_account = next_account_info(account_info_iter)?;

    let input = ViewCheckerRewardInput::try_from_slice(instruction_data)?;

    // Validate the PDA
    let (bmb_state_pda, _bump_seed) =
        Pubkey::find_program_address(&[GLOBAL_SEED, STATE_SEED], program_id);

    if *bmb_state_account.key != bmb_state_pda {
        msg!("Error: BMBState account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // BMBState account must exist
    if bmb_state_account.data_is_empty() {
        msg!("Error: BMBState account does not exist");
        return Err(ProgramError::UninitializedAccount);
    }

    // Load state
    let bmb_state: BMBState = read_account_data(
        &bmb_state_account.try_borrow_data()?,
        DepinAccountType::BMBState,
    )?;

    // Calculate the reward
    let reward = GlobalRewards::get_checker_reward(input.period, &bmb_state)?;

    msg!("Checker reward for period {}: {} lamports", input.period, reward);

    // Return the reward as bytes (little-endian u64)
    set_return_data(&reward.to_le_bytes());

    Ok(())
}
