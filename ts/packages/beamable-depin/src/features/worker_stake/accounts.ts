import { Address, getAddressEncoder, getProgramDerivedAddress, ProgramDerivedAddress } from "gill";
import {
    BMB_TREASURY_SEED,
    USDC_TREASURY_SEED,
    WORKER_STAKE_PROGRAM,
    WORKER_STAKE_VAULT_SEED
} from "../../constants.js";

const addressEncoder = getAddressEncoder();

export async function findWorkerStakeVaultPda(worker_collection: Address): Promise<ProgramDerivedAddress> {
    return await getProgramDerivedAddress({
        programAddress: WORKER_STAKE_PROGRAM,
        seeds: [WORKER_STAKE_VAULT_SEED, addressEncoder.encode(worker_collection)]
    });
}

export async function findUsdcTreasuryPda(worker_collection: Address): Promise<ProgramDerivedAddress> {
    return await getProgramDerivedAddress({
        programAddress: WORKER_STAKE_PROGRAM,
        seeds: [USDC_TREASURY_SEED, addressEncoder.encode(worker_collection)]
    });
}

export async function findBmbTreasuryPda(worker_collection: Address): Promise<ProgramDerivedAddress> {
    return await getProgramDerivedAddress({
        programAddress: WORKER_STAKE_PROGRAM,
        seeds: [BMB_TREASURY_SEED, addressEncoder.encode(worker_collection)]
    });
}