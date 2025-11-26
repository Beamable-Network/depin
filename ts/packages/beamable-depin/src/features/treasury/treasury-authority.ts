import { Address, getAddressEncoder, getProgramDerivedAddress, ProgramDerivedAddress } from "gill";
import { TREASURY_SEED, WORKER_STAKE_PROGRAM } from "../../constants.js";

const addressEncoder = getAddressEncoder();

export class TreasuryAuthority {
    // Treasury authority PDA
    public static async findWorkerStakeTreasuryPDA(worker_collection: Address): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: WORKER_STAKE_PROGRAM,
            seeds: [TREASURY_SEED, addressEncoder.encode(worker_collection)]
        });
        return pda;
    }
}