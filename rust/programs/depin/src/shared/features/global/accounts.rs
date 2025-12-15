use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;
use crate::shared::{constants::seeds::{GLOBAL_SEED, STATE_SEED}, types::ring_buffer::RingBuffer};
use depin_core::{types::account::DepinAccountType, utils::bmb::get_current_period};

/// Encoded period-checker data as u64
/// - Period: 16 bits (0-65535)
/// - Checker count: 32 bits (0-4294967295)
pub type PeriodCheckersData = u64;

const PERIOD_BUFFER_SIZE: usize = 16;

/// Helper functions for encoding/decoding period-checker data
pub struct PeriodCheckersCodec;

impl PeriodCheckersCodec {
    pub fn encode(period: u16, checker_count: u32) -> PeriodCheckersData {
        ((period as u64) << 48) | (checker_count as u64)
    }

    pub fn decode(value: PeriodCheckersData) -> (u16, u32) {
        let period = (value >> 48) as u16;
        let checker_count = (value & 0xFFFFFFFF) as u32;
        (period, checker_count)
    }
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct BMBState {
    pub period_checkers_buffer: RingBuffer<PeriodCheckersData, PERIOD_BUFFER_SIZE>,
    pub checkers_desired: u32,
    pub checkers_activated: u32,
    pub workers_activated: u32,
    pub remaining_checker_emissions: u64,
    pub remaining_checker_emissions_sync_month: u16,
}

impl BMBState {
    pub const LEN: usize = 1 +(8 * PERIOD_BUFFER_SIZE) + 1 + 4 + 4 + 4 + 8 + 2;

    pub fn new() -> Self {
        Self {
            period_checkers_buffer: RingBuffer::new(),
            checkers_desired: 1000, // Default initial desired checkers
            checkers_activated: 0,
            workers_activated: 0,
            remaining_checker_emissions: 0,
            remaining_checker_emissions_sync_month: 0,
        }
    }

    pub fn account_type() -> DepinAccountType {
        DepinAccountType::BMBState
    }

    pub fn find_pda(program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[GLOBAL_SEED, STATE_SEED], program_id)
    }

    pub fn set_period_checkers(&mut self, target_period: u16, checker_count: u32) {
        assert!(target_period > get_current_period(), "Target period must be future period");

        // Get the last written entry from the ring buffer
        if let Some(last_idx) = self.period_checkers_buffer.get_last_index() {
            let last_value = self.period_checkers_buffer.data[last_idx];
            let (last_period, _) = PeriodCheckersCodec::decode(last_value);

            if target_period < last_period {
                panic!("New period ({}) must be >= last period in buffer ({})", target_period, last_period);
            }

            // If periods match, update the existing entry and return
            if target_period == last_period {
                let encoded_value = PeriodCheckersCodec::encode(target_period, checker_count);
                self.period_checkers_buffer.data[last_idx] = encoded_value;
                return;
            }
        }

        // Add new entry to the ring buffer
        let encoded_value = PeriodCheckersCodec::encode(target_period, checker_count);
        self.period_checkers_buffer.push(encoded_value);
    }

    /// This method walks backwards from the current write position to find the most recent period <= target_period
    pub fn get_checker_count_for_period(&self, target_period: u16) -> Option<u32> {
        let current_idx = self.period_checkers_buffer.current_index() as usize;
        
        // Walk backwards from current position to find the most recent period <= target_period
        for i in 0..PERIOD_BUFFER_SIZE {
            let idx = if current_idx >= i { current_idx - i } else { PERIOD_BUFFER_SIZE + current_idx - i };
            let value = self.period_checkers_buffer.data[idx];
            
            if value == 0 {
                continue; // Skip empty entries
            }
            
            let (period, checker_count) = PeriodCheckersCodec::decode(value);
            
            // Since we're walking backwards and periods increase, 
            // the first period <= target_period is our answer
            if period <= target_period {
                return Some(checker_count);
            }
        }
        
        None
    }

    pub fn get_all_entries(&self) -> Vec<(u16, u32)> {
        self.period_checkers_buffer
            .iter_non_default()
            .map(|&value| PeriodCheckersCodec::decode(value))
            .collect()
    }
}
