use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{pubkey::Pubkey, program_error::ProgramError};

use crate::{shared::{constants::seeds::{GLOBAL_REWARDS_SEED, GLOBAL_SEED}, features::{global::accounts::BMBState, rewards::emission_schedule::get_node_emissions}}};
use depin_core::{constants::{DISC_SIZE}, utils::bmb::days_in_month};

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

    pub fn get_checker_reward(period: u16, bmb_state: &BMBState) -> Result<u64, ProgramError> {
        // Early return: Not seeking checkers = no rewards
        if bmb_state.checkers_desired == 0 {
            return Ok(0);
        }

        let month_period = depin_core::utils::bmb::get_month_from_period(period);
        let emissions = get_node_emissions(month_period);
        let days_in_month = days_in_month(month_period);

        let remaining_emissions = if bmb_state.remaining_checker_emissions_sync_month == month_period {
            bmb_state.remaining_checker_emissions
        } else {
            0
        };

        let total_checker_emissions = emissions.checkers
            .checked_add(remaining_emissions)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        // Early return if no emissions this month
        if total_checker_emissions == 0 {
            return Ok(0);
        }

        // Calculate max checker activities with overflow checks
        // checker_activities_max = workers_activated * 512 * days_in_month
        let checker_activities_max = (bmb_state.workers_activated as u64)
            .checked_mul(512)
            .and_then(|v| v.checked_mul(days_in_month as u64))
            .ok_or(ProgramError::ArithmeticOverflow)?;

        // Calculate active checker ratio (capped at 1.0)
        let ratio_numerator = if bmb_state.checkers_activated > bmb_state.checkers_desired {
            bmb_state.checkers_desired as u64
        } else {
            bmb_state.checkers_activated as u64
        };
        let ratio_denominator = bmb_state.checkers_desired as u64;

        // Pure integer arithmetic using u128 to prevent overflow
        // Formula: (ratio_numerator * total_emissions) / (ratio_denominator * max_activities)
        let numerator = (ratio_numerator as u128)
            .checked_mul(total_checker_emissions as u128)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        let denominator = (ratio_denominator as u128)
            .checked_mul(checker_activities_max as u128)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        // Division in u128 space (denominator cannot be 0 due to earlier checks)
        let activity_reward_u128 = numerator / denominator;
        let activity_reward = u64::try_from(activity_reward_u128)
            .map_err(|_| ProgramError::ArithmeticOverflow)?;

        Ok(activity_reward)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::features::global::accounts::BMBState;
    use crate::shared::types::ring_buffer::RingBuffer;

    fn create_bmb_state(
        checkers_activated: u32,
        checkers_desired: u32,
        workers_activated: u32,
        remaining_emissions: u64,
        sync_month: u16,
    ) -> BMBState {
        BMBState {
            period_checkers_buffer: RingBuffer::new(),
            checkers_desired,
            checkers_activated,
            workers_activated,
            remaining_checker_emissions: remaining_emissions,
            remaining_checker_emissions_sync_month: sync_month,
        }
    }

    #[test]
    fn test_month_5_reward_calculation() {
        // Month 5 (Nov 2025): First month with 20M scheduled emissions
        // - Checkers: 500 active / 1000 desired (0.5 ratio)
        // - Workers: 100 nodes
        // - Days: 30 (November has 30 days)
        // - Max activities: 100 * 512 * 30 = 1,536,000
        // Period 153 = November 1, 2025 (days: 153-182 = Nov 1-30)

        let period = 153; // November 1, 2025 (month 5)
        let bmb_state = create_bmb_state(
            500,  // checkers_activated
            1000, // checkers_desired
            100,  // workers_activated (100 nodes)
            0,    // remaining_checker_emissions
            5,    // sync_month
        );

        let reward = GlobalRewards::get_checker_reward(period, &bmb_state).unwrap();

        // Formula: (ratio_numerator * total_emissions) / (ratio_denominator * max_activities)
        // total_emissions = 20_000_000 * 10^9 (in smallest units)
        // = (500 * 20_000_000_000_000_000) / (1000 * 1_536_000)
        // = 10_000_000_000_000_000 / 1_536_000_000
        // = 6_510_416_666.67 (6.51 BMB)

        assert_eq!(reward, 6_510_416_666, "Month 5: Expected 6.51 BMB per activity (matches es.csv)");
    }

    #[test]
    fn test_month_6_reward_calculation() {
        // Month 6 (Dec 2025): Regular month with 1.5M scheduled emissions
        // - Checkers: 1000 active / 1500 desired (0.6667 ratio)
        // - Workers: 100 nodes
        // - Days: 31 (December has 31 days)
        // - Max activities: 100 * 512 * 31 = 1,587,200
        // Period 183 = December 1, 2025 (days: 183-213 = Dec 1-31)

        let period = 183; // December 1, 2025 (month 6)
        const BMB_MULTIPLIER: u64 = 1_000_000_000; // 10^9
        let bmb_state = create_bmb_state(
            1000, // checkers_activated
            1500, // checkers_desired
            100,  // workers_activated
            10_000_000 * BMB_MULTIPLIER, // remaining_checker_emissions from month 5 (in smallest units)
            6,    // sync_month
        );

        let reward = GlobalRewards::get_checker_reward(period, &bmb_state).unwrap();

        // Formula: (ratio_numerator * total_emissions) / (ratio_denominator * max_activities)
        // total_emissions = (1_500_000 + 10_000_000) * 10^9 = 11_500_000 * 10^9 (in smallest units)
        // = (1000 * 11_500_000_000_000_000) / (1500 * 1_587_200)
        // = 11_500_000_000_000_000_000 / 2_380_800_000
        // 4_830_309_139 (≈4.83 BMB)

        assert_eq!(reward, 4_830_309_139, "Month 6: Expected ≈4.83 BMB per activity (matches es.csv)");
    }

    #[test]
    fn test_zero_emissions() {
        // Test early months (0-4) with no emissions
        let period = 30; // Period in month 1
        let bmb_state = create_bmb_state(100, 1000, 100, 0, 1);

        let reward = GlobalRewards::get_checker_reward(period, &bmb_state).unwrap();
        assert_eq!(reward, 0, "Should return 0 for months with no emissions");
    }

    #[test]
    fn test_zero_desired_checkers() {
        // Test when no checkers are desired
        let period = 153; // November 1, 2025 (month 5)
        let bmb_state = create_bmb_state(500, 0, 100, 0, 5);

        let reward = GlobalRewards::get_checker_reward(period, &bmb_state).unwrap();
        assert_eq!(reward, 0, "Should return 0 when no checkers desired");
    }

    #[test]
    fn test_checkers_activated_exceeds_desired() {
        // Test ratio capping when activated > desired
        let period = 153; // November 1, 2025 (month 5)
        let bmb_state = create_bmb_state(
            1500, // checkers_activated (exceeds desired)
            1000, // checkers_desired
            100,  // workers_activated
            0,
            5,
        );

        let reward = GlobalRewards::get_checker_reward(period, &bmb_state).unwrap();

        // Ratio should be capped at 1.0 (1000/1000, not 1500/1000)
        // = (1000 * 20_000_000_000_000_000) / (1000 * 1_536_000)
        // = 20_000_000_000_000_000 / 1_536_000_000
        // = 13_020_833_333.33 (13.02 BMB)

        assert_eq!(reward, 13_020_833_333, "Ratio should be capped at 1.0, giving 13.02 BMB per activity");
    }
}
