use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;
use crate::types::WorkerStakeAccountType;

/// PDA: [b"worker_stake_config", worker_collection_pubkey]
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct WorkerStakeConfig {
    pub worker_collection: Pubkey,       // Worker collection (Metaplex Core collection)
    pub worker_wallet: Pubkey,           // BMB emission recipient (worker's wallet)
    pub min_stake_requirement: u64,      // Minimum total stake required to operate
    pub total_staked: u64,               // Total stake (worker + community) - kept in sync with vaults
    pub last_active_pool_month: u16,     // Last month_period with activity (0 = none)
    pub created_pools: Vec<u16>,         // Pre-created month_periods (auto-compacts past months)
                                         // MAX SIZE: 24 entries (2 years of monthly pools)
}

impl WorkerStakeConfig {
    pub const MAX_POOLS: usize = 24;

    // Base size: discriminator + worker_collection + worker_wallet + min_stake_requirement +
    // total_staked + last_active_pool_month + created_pools length prefix
    pub const BASE_SIZE: usize = 8 + 32 + 32 + 8 + 8 + 2 + 4;
    pub const MAX_SIZE: usize = Self::BASE_SIZE + (Self::MAX_POOLS * 2);

    pub const SEED: &'static [u8] = b"worker_stake_config";

    pub fn required_size(pool_count: usize) -> usize {
        Self::BASE_SIZE + pool_count * 2
    }

    pub fn find_pda(program_id: &Pubkey, worker_collection: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[Self::SEED, worker_collection.as_ref()],
            program_id
        )
    }

    pub fn account_type() -> WorkerStakeAccountType {
        WorkerStakeAccountType::WorkerStakeConfig
    }

    pub fn new(
        worker_collection: Pubkey,
        worker_wallet: Pubkey,
        min_stake_requirement: u64,
    ) -> Self {
        Self {
            worker_collection,
            worker_wallet,
            min_stake_requirement,
            total_staked: 0,
            last_active_pool_month: 0,
            created_pools: Vec::new(),
        }
    }
}
