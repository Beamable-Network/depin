import {
    AccountRole,
    Address,
    address,
    getAddressEncoder,
    getProgramDerivedAddress
} from "gill";

import { MPL_NOOP_PROGRAM_ID } from '@metaplex-foundation/mpl-account-compression';
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { BMB_MINT, DEPIN_PROGRAM, getCheckerTree, MPL_ACCOUNT_COMPRESSION_PROGRAM, MPL_CORE_PROGRAM_ADDRESS, SYSTEM_PROGRAM_ADDRESS } from "../../constants.js";
import { DepinInstruction } from "../../enums.js";
import { MPL_BUBBLEGUM_PROGRAM } from "../../utils/bubblegum.js";
import { CheckerLicenseAuthority } from "./checker-license-authority.js";
import { BMBStateAccount } from "../global/bmb-state-account.js";

export interface CreateMintCheckerInput {
    minter: Address;
    mintReceiver: Address;
    merkleTree?: Address;
    checkerCollection?: Address;
    network: "mainnet" | "devnet";
}

const addressEncoder = getAddressEncoder();

export class MintChecker {
    minter: Address;
    mintReceiver: Address;
    merkleTree?: Address;
    checkerCollection?: Address;
    network: "mainnet" | "devnet";

    constructor(input: CreateMintCheckerInput) {
        this.minter = input.minter;
        this.mintReceiver = input.mintReceiver;
        this.merkleTree = input.merkleTree;
        this.checkerCollection = input.checkerCollection;
        this.network = input.network;
    }

    private serialize(): Uint8Array {
        return Uint8Array.of(DepinInstruction.MintChecker);
    }
    public async getInstruction() {
        const [licenseAuthority] = await CheckerLicenseAuthority.findPDA();

        // Get minter's BMB token account
        const minterBmbTokenAccount = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: this.minter,
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        // Get payment receiver's BMB token account (checker authority)
        const paymentReceiverBmbTokenAccount = await findAssociatedTokenPda({
            mint: BMB_MINT,
            owner: licenseAuthority,
            tokenProgram: TOKEN_PROGRAM_ADDRESS
        });

        // Get network-specific tree
        const merkleTree = this.merkleTree ?? getCheckerTree(this.network);

        const [treeConfigPda] = await getProgramDerivedAddress({
            programAddress: MPL_BUBBLEGUM_PROGRAM,
            seeds: [addressEncoder.encode(merkleTree)]
        });

        const bmbStatePda = await BMBStateAccount.findPDA();
        
        const accounts = [
            { address: this.minter, role: AccountRole.WRITABLE_SIGNER },
            { address: minterBmbTokenAccount[0], role: AccountRole.WRITABLE },
            { address: this.mintReceiver, role: AccountRole.WRITABLE },
            { address: paymentReceiverBmbTokenAccount[0], role: AccountRole.WRITABLE },
            { address: bmbStatePda[0], role: AccountRole.WRITABLE },
            { address: merkleTree, role: AccountRole.WRITABLE },
            { address: treeConfigPda, role: AccountRole.WRITABLE },
            { address: licenseAuthority, role: AccountRole.READONLY },
            { address: this.checkerCollection ?? SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: MPL_BUBBLEGUM_PROGRAM, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: MPL_ACCOUNT_COMPRESSION_PROGRAM, role: AccountRole.READONLY },
            { address: BMB_MINT, role: AccountRole.READONLY },
            { address: address(MPL_NOOP_PROGRAM_ID), role: AccountRole.READONLY },
            { address: MPL_CORE_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ];

        return {
            programAddress: DEPIN_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}
