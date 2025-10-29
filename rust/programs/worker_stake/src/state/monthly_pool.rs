use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;
use crate::types::WorkerStakeAccountType;

/// Tracks pool metrics with time-weighting for reward distribution
/// Used by both base_pool and addon_pool
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Default)]
pub struct PoolMetricsWeighted {
    pub total: u64,                      // Raw total (BMB stake for base, points for addon)
    pub total_weighted: u64,             // Time-weighted for rewards
    pub total_opted_out: u64,            // Opted-out (excluded from next inheritance)
    pub collected: u64,                  // USDC revenue collected this month
}

/// PDA: [b"monthly_pool", worker_collection_pubkey, month_period_bytes]
/// These are OPTIONAL - only created when worker wants community staking with revenue sharing
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct MonthlyPool {
    pub worker_collection: Pubkey,       // Worker collection (Metaplex Core collection)
    pub month_period: u16,               // Months since June 2025
    pub base_revenue_percentage: u16,    // Base USDC revenue share - basis points (1000 = 10%)
    pub addon_revenue_percentage: u16,   // Addon USDC revenue share - basis points (1000 = 10%)
    pub base_emission_percentage: u16,   // Base BMB emission share - basis points (1000 = 10%)
    pub initialized: bool,               // Whether inheritance has run

    pub base_pool: PoolMetricsWeighted,  // All stakers, BMB-weighted with time-weighting
    pub addon_pool: PoolMetricsWeighted, // Checker license holders, points-based with time-weighting
    pub collected_bmb_base: u64,         // Base BMB emissions collected this month
}

impl MonthlyPool {
    // Size: 8 (disc) + 32 + 2 + 2 + 2 + 2 + 1 + (4*8) + (4*8) + 8 = ~157 bytes
    pub const SIZE: usize = 8 + 32 + 2 + 2 + 2 + 1 + 32 + 32 + 8;

    pub const SEED: &'static [u8] = b"monthly_pool";

    pub fn find_pda(program_id: &Pubkey, worker_collection: &Pubkey, month_period: u16) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[Self::SEED, worker_collection.as_ref(), &month_period.to_le_bytes()],
            program_id
        )
    }

    pub fn account_type() -> WorkerStakeAccountType {
        WorkerStakeAccountType::MonthlyPool
    }

    pub fn new(
        worker_collection: Pubkey,
        month_period: u16,
        base_revenue_percentage: u16,
        addon_revenue_percentage: u16,
        base_emission_percentage: u16,
    ) -> Self {
        Self {
            worker_collection,
            month_period,
            base_revenue_percentage,
            addon_revenue_percentage,
            base_emission_percentage,
            initialized: false,
            base_pool: PoolMetricsWeighted::default(),
            addon_pool: PoolMetricsWeighted::default(),
            collected_bmb_base: 0,
        }
    }
}
