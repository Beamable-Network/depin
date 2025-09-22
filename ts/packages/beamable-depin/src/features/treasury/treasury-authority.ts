import { getAddressEncoder, getProgramDerivedAddress, ProgramDerivedAddress } from "gill";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { DEPIN_PROGRAM, TREASURY_SEED, BMB_MINT } from "../../constants.js";

const addressEncoder = getAddressEncoder();

export class TreasuryAuthority {
    // Treasury authority PDA
    public static async findTreasuryPDA(): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: DEPIN_PROGRAM,
            seeds: [TREASURY_SEED]
        });
        return pda;
    }

    // Find treasury authority's associated token account for BMB tokens
    public static async findAssociatedTokenAccount(): Promise<ProgramDerivedAddress> {
        const treasuryPda = await this.findTreasuryPDA();
        
        const ata = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: treasuryPda[0],
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });

        return ata;
    }
}