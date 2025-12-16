import { address } from 'gill';

export const DEPIN_PROGRAM = address('BMBpXq5RaoRf5pGsQpuwjcozaLF2TuNCmYKKcFJjFiFS');
export const WORKER_STAKE_PROGRAM = address('WSTKhDg9nQ8h2ZmnmNdR6heSGU6uYJSwdUNpzSYXBSe');
export const MPL_ACCOUNT_COMPRESSION_PROGRAM = address("mcmt6YrQEMKw8Mw43FmpRLmf7BqRnFMKmAcbxE3xkAW");
export const BPF_LOADER_UPGRADEABLE_PROGRAM = address('BPFLoaderUpgradeab1e11111111111111111111111');
export const USDC_MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
export const BMB_MINT = address('BMBtwz6LFDJVJd2aZvL5F64fdvWP3RPn4NP5q9Xe15UD');
export const BMB_DECIMALS = 9;
export const ESCROW_SEED = "escrow";
export const TOKEN_SEED = "token";
export const TREASURY_SEED = "treasury";
export const CONFIG_SEED = "config";
export const GLOBAL_SEED = "global";
export const STATE_SEED = "state";
export const GLOBAL_REWARDS_SEED = "rewards";
export const PROOF_SEED = "proof";
export const WORKER_SEED = "worker";
export const CHECKER_SEED = "checker";
export const METADATA_SEED = "meta";
export const LICENSE_SEED = "license";
export const AUTHORITY_SEED = "authority";
export const LOCK_SEED = "lock";
export const VAULT_SEED = "vault";
export const FLEXLOCK_SEED = "flexlock";

export const WORKER_STAKE_CONFIG_SEED = "worker_stake_config";
export const MONTHLY_POOL_SEED = "monthly_pool";
export const USER_POSITION_SEED = "user_position";
export const WORKER_STAKE_VAULT_SEED = "worker_stake_vault";
export const COMMUNITY_STAKE_VAULT_SEED = "community_stake_vault";

export const SYSTEM_PROGRAM_ADDRESS = address('11111111111111111111111111111111');
export const MPL_CORE_PROGRAM_ADDRESS = address('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');

export const WORKER_TREE = address('BMBw28bkTSFicoKZGoYNJzWnSyUjDRcxr7Qoc5mCuxf5');
export const CHECKER_TREE = address('3eHEnELWr4fdVEhq4QKyyjAJ9N9cc197ZNjceb84QarW');
export function getCheckerTree(network: "mainnet" | "devnet") {
  return network === 'mainnet' ? CHECKER_TREE : address('BMBcEkev9ZEMdqYUjNirrsB4E8uuVfcno7haTcLnwkXo');
}