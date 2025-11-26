use crate::shared::features::rewards::accounts::CheckerRewardsVault;
use borsh::{BorshDeserialize, BorshSerialize};
use depin_core::{
    types::account::DepinAccountType,
    utils::{
        account::{read_account_data, write_account_data},
        program_data::validate_upgrade_authority,
        validation::validate_pda_account,
    },
};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct SetCheckerRewardsVaultInput {
    pub lock_days: Option<u16>,
}

pub fn process_set_checker_rewards_vault<'info>(
    program_id: &Pubkey,
    accounts: &'info [AccountInfo<'info>],
    instruction_data: &[u8],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Program upgrade authority
    // 1. [readonly] ProgramData account (contains upgrade authority)
    // 2. [writable] CheckerRewardsVault PDA account (must already exist)
    let account_info_iter = &mut accounts.iter();
    let upgrade_authority_account = next_account_info(account_info_iter)?;
    let program_data_account = next_account_info(account_info_iter)?;
    let checker_rewards_vault_account = next_account_info(account_info_iter)?;

    let input = SetCheckerRewardsVaultInput::try_from_slice(instruction_data)?;

    // Validate upgrade authority
    validate_upgrade_authority(program_id, program_data_account, upgrade_authority_account)?;

    // Validate the PDA
    let (checker_rewards_vault_pda, _bump_seed) = CheckerRewardsVault::find_pda(program_id);
    validate_pda_account(
        checker_rewards_vault_account,
        &checker_rewards_vault_pda,
        "CheckerRewardsVault",
    )?;

    // CheckerRewardsVault account must exist
    if checker_rewards_vault_account.data_is_empty() {
        msg!("Error: CheckerRewardsVault account does not exist");
        return Err(ProgramError::UninitializedAccount);
    }

    // Load existing config
    let mut checker_rewards_vault: CheckerRewardsVault = read_account_data(
        &checker_rewards_vault_account.try_borrow_data()?,
        DepinAccountType::CheckerRewardsVault,
    )?;

    // Update fields if provided
    let mut updated = false;

    if let Some(lock_days) = input.lock_days {
        msg!(
            "Updating lock_days: {} -> {}",
            checker_rewards_vault.lock_days,
            lock_days
        );
        checker_rewards_vault.lock_days = lock_days;
        updated = true;
    }

    if !updated {
        msg!("Warning: No fields were updated");
    }

    // Write the updated config back to the account
    let mut data = checker_rewards_vault_account.try_borrow_mut_data()?;
    write_account_data(
        &mut data,
        CheckerRewardsVault::account_type(),
        &checker_rewards_vault,
    )?;

    msg!("CheckerRewardsVault updated successfully");

    Ok(())
}
