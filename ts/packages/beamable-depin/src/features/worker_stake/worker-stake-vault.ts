import { Address, getAddressEncoder, getProgramDerivedAddress, ProgramDerivedAddress } from "gill";
import { COMMUNITY_STAKE_VAULT_SEED, WORKER_STAKE_PROGRAM, WORKER_STAKE_VAULT_SEED } from "../../constants.js";

const addressEncoder = getAddressEncoder();

export class WorkerStakeVault {

    public static async findWorkerStakeVaultPda(worker_collection: Address): Promise<ProgramDerivedAddress> {
        return await getProgramDerivedAddress({
            programAddress: WORKER_STAKE_PROGRAM,
            seeds: [WORKER_STAKE_VAULT_SEED, addressEncoder.encode(worker_collection)]
        });
    }

    public static async findCommunityStakeVaultPda(worker_collection: Address): Promise<ProgramDerivedAddress> {
        return await getProgramDerivedAddress({
            programAddress: WORKER_STAKE_PROGRAM,
            seeds: [COMMUNITY_STAKE_VAULT_SEED, addressEncoder.encode(worker_collection)]
        });
    }
}