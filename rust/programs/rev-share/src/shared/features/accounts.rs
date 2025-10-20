use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

use crate::shared::{
    constants::{REVSHARE_SEED, STATE_SEED, OFFER_SEED, USER_SEED, AUTHORITY_SEED},
    types::account::RevShareAccountType,
};

/// Global state tracking the latest offer ID
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct GlobalState {
    pub last_offer_id: u32,
}

impl GlobalState {
    pub const LEN: usize = 1 + 4; // discriminator + u32

    pub fn new() -> Self {
        Self { last_offer_id: 0 }
    }

    pub fn find_pda(program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[REVSHARE_SEED, STATE_SEED], program_id)
    }

    pub fn account_type() -> RevShareAccountType {
        RevShareAccountType::GlobalState
    }
}

/// Revenue sharing offer with time-weighted staking rewards
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct RevShareOffer {
    pub offer_id: u32,
    pub start_time: i64,
    pub end_time: i64,
    pub revenue_percentage: u16, // basis points (500 = 5%)
    pub total_staked: u64,
    pub total_staked_weighted: u64,
    pub total_staked_opted_out: u64,
    pub collected_usdc: u64,
}

impl RevShareOffer {
    pub const LEN: usize = 1 + 4 + 8 + 8 + 2 + 8 + 8 + 8 + 8; // discriminator + fields

    pub fn new(offer_id: u32, start_time: i64, end_time: i64, revenue_percentage: u16) -> Self {
        Self {
            offer_id,
            start_time,
            end_time,
            revenue_percentage,
            total_staked: 0,
            total_staked_weighted: 0,
            total_staked_opted_out: 0,
            collected_usdc: 0,
        }
    }

    pub fn find_pda(program_id: &Pubkey, offer_id: u32) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[REVSHARE_SEED, OFFER_SEED, &offer_id.to_le_bytes()],
            program_id,
        )
    }

    pub fn account_type() -> RevShareAccountType {
        RevShareAccountType::RevShareOffer
    }

    /// Calculate the time-based weight for a stake entry
    /// Returns the weighted amount based on when the stake was added
    pub fn calculate_stake_weight(&self, amount: u64, stake_timestamp: i64) -> u64 {
        // If stake was before offer started, full weight
        if stake_timestamp < self.start_time {
            return amount;
        }

        // If stake was after offer ended, no weight
        if stake_timestamp >= self.end_time {
            return 0;
        }

        // Stake was during the offer, calculate partial weight
        let total_duration = self.end_time - self.start_time;
        let remaining_duration = self.end_time - stake_timestamp;

        // Weight = amount × (remaining_duration / total_duration)
        // Using u128 to prevent overflow during multiplication
        let weighted = (amount as u128)
            .checked_mul(remaining_duration as u128)
            .and_then(|v| v.checked_div(total_duration as u128))
            .and_then(|v| u64::try_from(v).ok())
            .unwrap_or(0);

        weighted
    }
}

/// Individual stake entry tracking amount and timestamp
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct StakeEntry {
    pub amount: u64,
    pub timestamp: i64,
}

impl StakeEntry {
    pub const LEN: usize = 8 + 8; // u64 + i64
}

/// User's stake position with multiple entries
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct UserStakePosition {
    pub user: Pubkey,
    pub staked_amount: u64,
    pub stake_entries: Vec<StakeEntry>,
    pub opted_out_at_offer: u32,
    pub last_claimed_offer: u32,
}

impl UserStakePosition {
    pub const BASE_LEN: usize = 1 + 32 + 8 + 4 + 4 + 4; // discriminator + pubkey + u64 + Vec len + 2x u32

    pub fn new(user: Pubkey) -> Self {
        Self {
            user,
            staked_amount: 0,
            stake_entries: Vec::new(),
            opted_out_at_offer: 0,
            last_claimed_offer: 0,
        }
    }

    pub fn len(&self) -> usize {
        Self::BASE_LEN + (self.stake_entries.len() * StakeEntry::LEN)
    }

    pub fn find_pda(program_id: &Pubkey, user: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[REVSHARE_SEED, USER_SEED, user.as_ref()], program_id)
    }

    pub fn account_type() -> RevShareAccountType {
        RevShareAccountType::UserStakePosition
    }

    /// Calculate user's total weighted stake for a specific offer
    pub fn calculate_weighted_stake_for_offer(&self, offer: &RevShareOffer) -> u64 {
        self.stake_entries
            .iter()
            .map(|entry| offer.calculate_stake_weight(entry.amount, entry.timestamp))
            .sum()
    }

    /// Check if user has opted out
    pub fn has_opted_out(&self) -> bool {
        self.opted_out_at_offer > 0
    }

    /// Check if user is eligible for rewards from a specific offer
    pub fn is_eligible_for_offer(&self, offer_id: u32) -> bool {
        // User is eligible if:
        // - They haven't opted out (opted_out_at_offer == 0), OR
        // - They opted out at or after this offer (opted_out_at_offer >= offer_id)
        self.opted_out_at_offer == 0 || self.opted_out_at_offer >= offer_id
    }
}

/// Authority PDA for owning treasury ATAs
pub struct Authority;

impl Authority {
    pub fn find_pda(program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[REVSHARE_SEED, AUTHORITY_SEED], program_id)
    }
}
