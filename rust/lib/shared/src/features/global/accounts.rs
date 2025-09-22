use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;
use crate::{constants::seeds::{GLOBAL_SEED, STATE_SEED}, types::{account::DepinAccountType, ring_buffer::RingBuffer}};

/// Encoded period-checker data as u64
/// - Period: 16 bits (0-65535)
/// - Checker count: 32 bits (0-4294967295)
pub type PeriodCheckersData = u64;

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
    pub period_checkers_buffer: RingBuffer<PeriodCheckersData, 16>,
}

impl BMBState {
    pub const LEN: usize = 1 +(8 * 16) + 1;

    pub fn new() -> Self {
        Self {
            period_checkers_buffer: RingBuffer::new(),
        }
    }

    pub fn account_type() -> DepinAccountType {
        DepinAccountType::BMBState
    }

    pub fn find_pda(program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[GLOBAL_SEED, STATE_SEED], program_id)
    }

    pub fn add_period_entry(&mut self, period: u16, checker_count: u32) {
        let encoded_value = PeriodCheckersCodec::encode(period, checker_count);
        self.period_checkers_buffer.push(encoded_value);
    }

    /// This method walks backwards from the current write position to find the most recent period <= target_period
    pub fn get_checker_count_for_period(&self, target_period: u16) -> Option<u32> {
        let current_idx = self.period_checkers_buffer.current_index() as usize;
        
        // Walk backwards from current position to find the most recent period <= target_period
        for i in 0..16 {
            let idx = if current_idx >= i { current_idx - i } else { 16 + current_idx - i };
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

    pub fn current_index(&self) -> u8 {
        self.period_checkers_buffer.current_index()
    }
}