import { getProgramDerivedAddress, ProgramDerivedAddress } from "gill";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { REV_SHARE_PROGRAM, REVSHARE_SEED, REVSHARE_AUTHORITY_SEED } from "./rev-share-constants.js";
import { BMB_MINT, USDC_MINT } from "../../constants.js";

export class RevShareAuthority {
    public static async findAuthorityPDA(): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: REV_SHARE_PROGRAM,
            seeds: [REVSHARE_SEED, REVSHARE_AUTHORITY_SEED]
        });
        return pda;
    }

    public static async findBmbTreasuryATA(): Promise<ProgramDerivedAddress> {
        const authorityPda = await this.findAuthorityPDA();
        const [ata, bump] = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: authorityPda[0],
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        return [ata, bump];
    }

    public static async findUsdcTreasuryATA(): Promise<ProgramDerivedAddress> {
        const authorityPda = await this.findAuthorityPDA();
        const [ata, bump] = await findAssociatedTokenPda({
            mint: USDC_MINT,
            owner: authorityPda[0],
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        return [ata, bump];
    }
}
