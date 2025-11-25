use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

use crate::shared::constants::seeds::{FLEXLOCK_SEED, LOCK_SEED, VAULT_SEED};
use depin_core::types::account::DepinAccountType;

pub struct FlexlockVaultAuthority;

impl FlexlockVaultAuthority {
    /// Find the PDA for the flexlock vault authority
    pub fn find_pda(program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[VAULT_SEED, FLEXLOCK_SEED], program_id)
    }
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct FlexlockTokens {
    pub sender: Pubkey,
    pub receiver: Pubkey,
    pub amount: u64,
    pub lock_period: u16,    // Period when tokens were locked
    pub unlock_period: u16,  // Period when tokens can be unlocked without penalty
}

impl FlexlockTokens {
    pub const LEN: usize = 1 + 32 + 32 + 8 + 2 + 2; // discriminator + sender + receiver + total_locked + lock_period + unlock_period

    pub fn find_pda(program_id: &Pubkey, sender: &Pubkey, receiver: &Pubkey, lock_period: u16, unlock_period: u16) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[
                FLEXLOCK_SEED,
                LOCK_SEED,
                sender.as_ref(),
                receiver.as_ref(),
                &lock_period.to_le_bytes(),
                &unlock_period.to_le_bytes(),
            ],
            program_id,
        )
    }

    pub fn account_type() -> DepinAccountType {
        DepinAccountType::FlexlockTokens
    }

    pub fn new(sender: Pubkey, receiver: Pubkey, amount: u64, lock_period: u16, unlock_period: u16) -> Self {
        Self {
            sender,
            receiver: receiver,
            amount,
            lock_period,
            unlock_period,
        }
    }

    pub fn add_tokens(&mut self, amount: u64) {
        self.amount = self.amount.saturating_add(amount);
    }
}
