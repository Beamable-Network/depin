use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{pubkey::Pubkey, program_error::ProgramError};

use crate::constants::{seeds::{GLOBAL_REWARDS_SEED, GLOBAL_SEED}, accounts::DISC_SIZE};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct GlobalRewards {
    pub checkers: [u32; 100_000],
}

impl GlobalRewards {
    pub const ELEMENTS: usize = 100_000;
    pub const LEN: usize = 1 + (GlobalRewards::ELEMENTS * 4);

    pub fn find_pda(program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[GLOBAL_SEED, GLOBAL_REWARDS_SEED], program_id)
    }

    pub fn get_checker_reward(period: u16) -> u16 {
        let month = crate::utils::bmb::get_month_from_period(period);

        match month {
            // Year 1 (2025-2026) - Months 0-11
            0 => 1000,   // Jun 2025: 1000
            1 => 950,    // Jul 2025: 950
            2 => 900,    // Aug 2025: 900
            3 => 850,    // Sep 2025: 850
            4 => 800,    // Oct 2025: 800
            5 => 750,    // Nov 2025: 750
            6 => 700,    // Dec 2025: 700
            7 => 650,    // Jan 2026: 650
            8 => 600,    // Feb 2026: 600
            9 => 550,    // Mar 2026: 550
            10 => 500,   // Apr 2026: 500
            11 => 450,   // May 2026: 450

            // Year 2 (2026-2027) - Months 12-23
            12..=17 => 400,   // Jun-Nov 2026: 400
            18..=23 => 350,   // Dec 2026-May 2027: 350

            // Year 3 (2027-2028) - Months 24-35
            24..=29 => 300,   // Jun-Nov 2027: 300
            30..=35 => 250,   // Dec 2027-May 2028: 250

            // Year 4 (2028-2029) - Months 36-47
            36..=41 => 200,   // Jun-Nov 2028: 200
            42..=47 => 175,   // Dec 2028-May 2029: 175

            // Year 5 (2029-2030) - Months 48-59
            48..=53 => 150,   // Jun-Nov 2029: 150
            54..=59 => 125,   // Dec 2029-May 2030: 125

            // Year 6+ (2030+) - Months 60+
            _ => 100,         // Jun 2030+: 100
        }
    }

    pub fn read_checker_balance(account_data: &[u8], checker_index: usize) -> Result<u32, ProgramError> {
        if checker_index >= Self::ELEMENTS {
            return Err(ProgramError::InvalidInstructionData);
        }

        let checker_bytes = &account_data[DISC_SIZE..];
        const ELEM_SIZE: usize = core::mem::size_of::<u32>();
        
        let start = checker_index * ELEM_SIZE;
        let end = start + ELEM_SIZE;
        
        let balance = u32::from_le_bytes(checker_bytes[start..end].try_into().unwrap());
        Ok(balance)
    }

    pub fn add_checker_balance(account_data: &mut [u8], checker_index: usize, reward_amount: u32) -> Result<(), ProgramError> {
        if checker_index >= Self::ELEMENTS {
            return Err(ProgramError::InvalidInstructionData);
        }

        let checker_bytes = &mut account_data[DISC_SIZE..];
        const ELEM_SIZE: usize = core::mem::size_of::<u32>();
        
        let start = checker_index * ELEM_SIZE;
        let end = start + ELEM_SIZE;

        let current_balance = u32::from_le_bytes(checker_bytes[start..end].try_into().unwrap());
        let new_balance = current_balance.saturating_add(reward_amount);
        
        checker_bytes[start..end].copy_from_slice(&new_balance.to_le_bytes());
        Ok(())
    }

    pub fn reset_checker_balance(account_data: &mut [u8], checker_index: usize) -> Result<(), ProgramError> {
        if checker_index >= Self::ELEMENTS {
            return Err(ProgramError::InvalidInstructionData);
        }

        let checker_bytes = &mut account_data[DISC_SIZE..];
        const ELEM_SIZE: usize = core::mem::size_of::<u32>();
        
        let start = checker_index * ELEM_SIZE;
        let end = start + ELEM_SIZE;

        checker_bytes[start..end].copy_from_slice(&0u32.to_le_bytes());
        Ok(())
    }
}
