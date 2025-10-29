use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct StakeEntry {
    pub amount: u64,
    pub timestamp: i64,
    pub month_period: u16,   // Pre-calculated at stake time for efficient claiming
    pub checker_count: u16,  // Number of checker licenses owned (vouched by worker)
}

impl StakeEntry {
    pub const SIZE: usize = 8 + 8 + 2 + 2; // 20 bytes
}

/// PDA: [b"user_position", user_pubkey, worker_collection_pubkey]
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct UserStakePosition {
    pub user: Pubkey,                    // Staker
    pub worker_collection: Pubkey,       // Worker collection (Metaplex Core collection)
    pub staked_amount: u64,              // Total stake
    pub stake_entries: Vec<StakeEntry>,  // Entries with timestamps
                                         // MAX SIZE: 25 entries (~2 years of monthly stakes)
    pub opted_out_at_month_period: u16,  // Unstake month (0 = not unstaked)
    pub last_claimed_month_period: u16,  // Last claimed month (0 = none)
}

impl UserStakePosition {
    pub const MAX_ENTRIES: usize = 25;

    // Base size: discriminator + user + worker_collection + staked_amount + vec len + opts
    pub const BASE_SIZE: usize = 8 + 32 + 32 + 8 + 4 + 2 + 2;

    // Max size: 8 (disc) + 32 + 32 + 8 + 4 + (25 * 20) + 2 + 2 = 584 bytes
    pub const MAX_SIZE: usize = Self::BASE_SIZE + (Self::MAX_ENTRIES * StakeEntry::SIZE);

    pub fn required_size(entry_count: usize) -> usize {
        Self::BASE_SIZE + (entry_count * StakeEntry::SIZE)
    }
}
