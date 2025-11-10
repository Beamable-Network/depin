import { Address, getAddressEncoder, getProgramDerivedAddress, ProgramDerivedAddress } from "gill";
import { DEPIN_PROGRAM, TREASURY_SEED, WORKER_STAKE_PROGRAM } from "../../constants.js";

const addressEncoder = getAddressEncoder();

export class TreasuryAuthority {
    // Treasury authority PDA
    public static async findDepinTreasuryPDA(): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: DEPIN_PROGRAM,
            seeds: [TREASURY_SEED]
        });
        return pda;
    }

    // Treasury authority PDA
    public static async finWorkerStakeTreasuryPDA(worker_collection: Address): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: WORKER_STAKE_PROGRAM,
            seeds: [TREASURY_SEED, addressEncoder.encode(worker_collection)]
        });
        return pda;
    }
}