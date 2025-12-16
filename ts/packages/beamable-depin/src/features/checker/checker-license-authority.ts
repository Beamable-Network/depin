import { getProgramDerivedAddress, ProgramDerivedAddress } from "gill";
import { AUTHORITY_SEED, CHECKER_SEED, DEPIN_PROGRAM, LICENSE_SEED } from "../../constants.js";

export class CheckerLicenseAuthority {
    public static async findPDA(): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: DEPIN_PROGRAM,
            seeds: [CHECKER_SEED, LICENSE_SEED, AUTHORITY_SEED]
        });
        return pda;
    }
}
