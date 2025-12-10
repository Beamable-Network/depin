use solana_program::pubkey::Pubkey;

pub const DISC_SIZE: usize = 1;
pub const BMB_DECIMALS: u8 = 9;
pub const BMB_MULTIPLIER: u64 = 10_u64.pow(BMB_DECIMALS as u32);
pub const USDC_DECIMALS: u8 = 6;

pub const USDC_MINT: Pubkey = solana_program::pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
pub const BMB_MINT: Pubkey = solana_program::pubkey!("BMBtwz6LFDJVJd2aZvL5F64fdvWP3RPn4NP5q9Xe15UD");

pub const CHECKER_TREE: Pubkey = solana_program::pubkey!("3eHEnELWr4fdVEhq4QKyyjAJ9N9cc197ZNjceb84QarW");
pub const WORKER_TREE: Pubkey = solana_program::pubkey!("BMBw28bkTSFicoKZGoYNJzWnSyUjDRcxr7Qoc5mCuxf5");

pub const MPL_ACCOUNT_COMPRESSION_PROGRAM: Pubkey = solana_program::pubkey!("mcmt6YrQEMKw8Mw43FmpRLmf7BqRnFMKmAcbxE3xkAW");
pub const BPF_LOADER_UPGRADEABLE_PROGRAM: Pubkey = solana_program::pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");