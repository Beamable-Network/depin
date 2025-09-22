use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

use crate::{constants::seeds::{LOCK_SEED, STATE_SEED, TREASURY_SEED, CONFIG_SEED}, types::account::DepinAccountType};

pub struct TreasuryAuthority;

impl TreasuryAuthority {
    /// Find the PDA for the treasury authority
    pub fn find_pda(program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[TREASURY_SEED], program_id)
    }
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct TreasuryState {
    pub locked_balance: u64,
}

impl TreasuryState {
    pub const LEN: usize = 1 + 8;

    pub fn new() -> Self {
        Self {
            locked_balance: 0,
        }
    }

    pub fn find_pda(program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[TREASURY_SEED, STATE_SEED], program_id)
    }
    
    pub fn account_type() -> DepinAccountType {
        DepinAccountType::TreasuryState
    }

    pub fn add_locked_balance(&mut self, amount: u64) {
        self.locked_balance = self.locked_balance.saturating_add(amount);
    }

    pub fn subtract_locked_balance(&mut self, amount: u64) {
        self.locked_balance = self.locked_balance.saturating_sub(amount);
    }

    pub fn get_locked_balance(&self) -> u64 {
        self.locked_balance
    }
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct TreasuryConfig {
    pub checker_rewards_lock_days: u16,
}

impl TreasuryConfig {
    pub const LEN: usize = 1 + 2;

    pub fn new() -> Self {
        Self {
            checker_rewards_lock_days: 365,
        }
    }

    pub fn find_pda(program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[TREASURY_SEED, CONFIG_SEED], program_id)
    }

    pub fn account_type() -> DepinAccountType {
        DepinAccountType::TreasuryConfig
    }
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct LockedTokens {
    pub owner: Pubkey,
    pub total_locked: u64,
    pub lock_period: u16,    // Period when tokens were locked
    pub unlock_period: u16,  // Period when tokens can be unlocked without penalty
    pub unlocked_at: Option<i64>, // Timestamp when tokens were unlocked (None if still locked)
}

impl LockedTokens {
    pub const LEN: usize = 1 + 32 + 8 + 2 + 2 + 1 + 8; // discriminator + owner + total_locked + lock_period + unlock_period + Option<i64>

    pub fn find_pda(program_id: &Pubkey, owner: &Pubkey, lock_period: u16, unlock_period: u16) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[
                TREASURY_SEED,
                LOCK_SEED,
                owner.as_ref(),
                &lock_period.to_le_bytes(),
                &unlock_period.to_le_bytes(),
            ],
            program_id,
        )
    }
    
    pub fn account_type() -> DepinAccountType {
        DepinAccountType::LockedTokens
    }

    pub fn new(owner: Pubkey, amount: u64, lock_period: u16, unlock_period: u16) -> Self {
        Self {
            owner,
            total_locked: amount,
            lock_period,
            unlock_period,
            unlocked_at: None,
        }
    }

    pub fn add_tokens(&mut self, amount: u64) {
        self.total_locked = self.total_locked.saturating_add(amount);
    }
}
