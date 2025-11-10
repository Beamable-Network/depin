use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{pubkey::Pubkey, program_error::ProgramError};

use crate::{shared::{constants::seeds::{GLOBAL_REWARDS_SEED, GLOBAL_SEED}, features::{global::accounts::BMBState, rewards::emission_schedule::get_node_emissions}}};
use depin_core::{constants::{BMB_DECIMALS, DISC_SIZE}, utils::bmb::days_in_month};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct GlobalRewards {
    pub checkers: [u64; 100_000],
    pub pending_rewards: u64,
    pub lifetime_rewards: u64,
}

impl GlobalRewards {
    pub const ELEMENTS: usize = 100_000;
    pub const LEN: usize = 1 + (GlobalRewards::ELEMENTS * 8) + 8 + 8;

    pub fn find_pda(program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[GLOBAL_SEED, GLOBAL_REWARDS_SEED], program_id)
    }

    pub fn get_checker_reward(period: u16, bmb_state: &BMBState) -> u64 {        
        let month_period = depin_core::utils::bmb::get_month_from_period(period);
        let emissions = get_node_emissions(month_period);
        let days_in_month = days_in_month(month_period);
        
        let active_checkers_ratio = if bmb_state.checkers_desired == 0 {
            1.0
        } else {
            let ratio = bmb_state.checkers_activated as f64 / bmb_state.checkers_desired as f64;
            if ratio > 1.0 { 1.0 } else { ratio }
        };

        let remaining_emissions = if bmb_state.remaining_checker_emissions_sync_month == month_period {
            bmb_state.remaining_checker_emissions
        } else {
            0
        };
        let total_checker_emissions = emissions.checkers + remaining_emissions;

        let checker_activities_max = bmb_state.workers_activated as u64 * 512 as u64 * days_in_month as u64;

        let activity_reward = ((active_checkers_ratio * total_checker_emissions as f64) / checker_activities_max as f64).floor() as u64;
        activity_reward * 10_u64.pow(BMB_DECIMALS as u32)
    }

    const fn pending_offset() -> usize {
        const ELEM_SIZE: usize = core::mem::size_of::<u64>();
        DISC_SIZE + (Self::ELEMENTS * ELEM_SIZE)
    }

    const fn lifetime_offset() -> usize {
        Self::pending_offset() + 8
    }

    fn read_pending_rewards(account_data: &[u8]) -> u64 {
        let offset = Self::pending_offset();
        u64::from_le_bytes(account_data[offset..offset + 8].try_into().unwrap())
    }

    fn add_pending_rewards(account_data: &mut [u8], amount: u64) {
        let offset = Self::pending_offset();
        let current = Self::read_pending_rewards(account_data);
        let new_value = current.saturating_add(amount);
        account_data[offset..offset + 8].copy_from_slice(&new_value.to_le_bytes());
    }

    fn subtract_pending_rewards(account_data: &mut [u8], amount: u64) {
        let offset = Self::pending_offset();
        let current = Self::read_pending_rewards(account_data);
        let new_value = current.saturating_sub(amount);
        account_data[offset..offset + 8].copy_from_slice(&new_value.to_le_bytes());
    }

    fn read_lifetime_rewards(account_data: &[u8]) -> u64 {
        let offset = Self::lifetime_offset();
        u64::from_le_bytes(account_data[offset..offset + 8].try_into().unwrap())
    }

    fn add_lifetime_rewards(account_data: &mut [u8], amount: u64) {
        let offset = Self::lifetime_offset();
        let current = Self::read_lifetime_rewards(account_data);
        let new_value = current.saturating_add(amount);
        account_data[offset..offset + 8].copy_from_slice(&new_value.to_le_bytes());
    }

    pub fn read_checker_balance(account_data: &[u8], checker_index: usize) -> Result<u64, ProgramError> {
        if checker_index >= Self::ELEMENTS {
            return Err(ProgramError::InvalidInstructionData);
        }

        let checker_bytes = &account_data[DISC_SIZE..];
        const ELEM_SIZE: usize = core::mem::size_of::<u64>();

        let start = checker_index * ELEM_SIZE;
        let end = start + ELEM_SIZE;

        let balance = u64::from_le_bytes(checker_bytes[start..end].try_into().unwrap());
        Ok(balance)
    }

    pub fn add_checker_balance(account_data: &mut [u8], checker_index: usize, reward_amount: u64) -> Result<(), ProgramError> {
        if checker_index >= Self::ELEMENTS {
            return Err(ProgramError::InvalidInstructionData);
        }

        let checker_bytes = &mut account_data[DISC_SIZE..];
        const ELEM_SIZE: usize = core::mem::size_of::<u64>();

        let start = checker_index * ELEM_SIZE;
        let end = start + ELEM_SIZE;

        let current_balance = u64::from_le_bytes(checker_bytes[start..end].try_into().unwrap());
        let new_balance = current_balance.saturating_add(reward_amount);

        checker_bytes[start..end].copy_from_slice(&new_balance.to_le_bytes());

        // Update pending_rewards and lifetime_rewards
        Self::add_pending_rewards(account_data, reward_amount);
        Self::add_lifetime_rewards(account_data, reward_amount);

        Ok(())
    }

    pub fn reset_checker_balance(account_data: &mut [u8], checker_index: usize, old_balance: u64) -> Result<(), ProgramError> {
        if checker_index >= Self::ELEMENTS {
            return Err(ProgramError::InvalidInstructionData);
        }

        let checker_bytes = &mut account_data[DISC_SIZE..];
        const ELEM_SIZE: usize = core::mem::size_of::<u64>();

        let start = checker_index * ELEM_SIZE;
        let end = start + ELEM_SIZE;

        checker_bytes[start..end].copy_from_slice(&0u64.to_le_bytes());

        // Remove old_balance from pending_rewards
        Self::subtract_pending_rewards(account_data, old_balance);

        Ok(())
    }
}
