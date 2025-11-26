import { getProgramDerivedAddress, ProgramDerivedAddress } from "gill";
import { DEPIN_PROGRAM, VAULT_SEED, FLEXLOCK_SEED } from "../../constants.js";

export class FlexlockVault {
    // Flexlock vault PDA
    public static async findFlexlockVaultPDA(): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: DEPIN_PROGRAM,
            seeds: [VAULT_SEED, FLEXLOCK_SEED]
        });
        return pda;
    }
}
