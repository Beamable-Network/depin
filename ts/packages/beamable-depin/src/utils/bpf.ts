import { Address, getAddressEncoder, getProgramDerivedAddress } from "gill";
import { BPF_LOADER_UPGRADEABLE_PROGRAM } from "../constants.js";

const addressEncoder = getAddressEncoder();

/**
 * Get the ProgramData account address for a given program.
 * 
 * The BPF Loader Upgradeable program stores program data in a PDA
 * derived from the program address itself.
 * 
 * @param programAddress - The address of the upgradeable program
 * @returns The ProgramData account address
 */
export async function getProgramDataAddress(programAddress: Address): Promise<Address> {
    const programBytes = addressEncoder.encode(programAddress);
    const [programDataAddress] = await getProgramDerivedAddress({
        programAddress: BPF_LOADER_UPGRADEABLE_PROGRAM,
        seeds: [programBytes]
    });
    return programDataAddress;
}
