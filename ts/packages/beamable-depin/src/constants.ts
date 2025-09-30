import { address } from 'gill';

export const DEPIN_PROGRAM = address('BMBpXq5RaoRf5pGsQpuwjcozaLF2TuNCmYKKcFJjFiFS');
export const MPL_ACCOUNT_COMPRESSION_PROGRAM = address("mcmt6YrQEMKw8Mw43FmpRLmf7BqRnFMKmAcbxE3xkAW");
export const USDC_MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
export const BMB_MINT = address('BMBc2jhS1otEzpXJH3UiTALQBQkpmx9m8TUW3zyMvKYJ');
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
export const LOCK_SEED = "lock";
export const SYSTEM_PROGRAM_ADDRESS = address('11111111111111111111111111111111');

export const WORKER_TREE = address('BMBw28bkTSFicoKZGoYNJzWnSyUjDRcxr7Qoc5mCuxf5');

export const CHECKER_TREE = address('3eHEnELWr4fdVEhq4QKyyjAJ9N9cc197ZNjceb84QarW');
export function getCheckerTree(network: "mainnet" | "devnet") {
  return network === 'mainnet' ? CHECKER_TREE : address('BMBcEkev9ZEMdqYUjNirrsB4E8uuVfcno7haTcLnwkXo');
}