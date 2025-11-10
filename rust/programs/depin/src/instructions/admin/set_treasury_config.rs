use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use crate::shared::{
    constants::seeds::{TREASURY_SEED, CONFIG_SEED},
    features::treasury::accounts::TreasuryConfig,
};
use depin_core::{
    types::account::DepinAccountType,
    utils::{
        account::{read_account_data, write_account_data},
        program_data::validate_upgrade_authority
    }
};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct SetTreasuryConfigInput {
    pub checker_rewards_lock_days: Option<u16>,
}

pub fn process_set_treasury_config<'info>(
    program_id: &Pubkey,
    accounts: &'info [AccountInfo<'info>],
    instruction_data: &[u8],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Program upgrade authority
    // 1. [readonly] ProgramData account (contains upgrade authority)
    // 2. [writable] TreasuryConfig PDA account (must already exist)
    let account_info_iter = &mut accounts.iter();
    let upgrade_authority_account = next_account_info(account_info_iter)?;
    let program_data_account = next_account_info(account_info_iter)?;
    let treasury_config_account = next_account_info(account_info_iter)?;

    let input = SetTreasuryConfigInput::try_from_slice(instruction_data)?;

    // Validate upgrade authority
    validate_upgrade_authority(
        program_id,
        program_data_account,
        upgrade_authority_account
    )?;

    // Validate the PDA
    let (treasury_config_pda, _bump_seed) = Pubkey::find_program_address(
        &[TREASURY_SEED, CONFIG_SEED],
        program_id,
    );

    if *treasury_config_account.key != treasury_config_pda {
        msg!("Error: TreasuryConfig account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // TreasuryConfig account must exist
    if treasury_config_account.data_is_empty() {
        msg!("Error: TreasuryConfig account does not exist");
        return Err(ProgramError::UninitializedAccount);
    }

    // Load existing config
    let mut treasury_config: TreasuryConfig = read_account_data(
        &treasury_config_account.try_borrow_data()?,
        DepinAccountType::TreasuryConfig,
    )?;

    // Update fields if provided
    let mut updated = false;

    if let Some(checker_rewards_lock_days) = input.checker_rewards_lock_days {
        msg!("Updating checker_rewards_lock_days: {} -> {}", treasury_config.checker_rewards_lock_days, checker_rewards_lock_days);
        treasury_config.checker_rewards_lock_days = checker_rewards_lock_days;
        updated = true;
    }

    if !updated {
        msg!("Warning: No fields were updated");
    }

    // Write the updated config back to the account
    let mut data = treasury_config_account.try_borrow_mut_data()?;
    write_account_data(&mut data, TreasuryConfig::account_type(), &treasury_config)?;

    msg!("Treasury config updated successfully");

    Ok(())
}
