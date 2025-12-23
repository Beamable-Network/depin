import { BMB_DECIMALS, BMB_MINT, getUsdcMint } from '@beamable-network/depin';
import { Address } from 'gill';
import { LiteDepin, LiteKeyPair, TransactionResult } from './lite-depin.js';

/**
 * SPL Token utilities for managing BMB and USDC tokens in tests.
 * Provides mint authorities and minting functions.
 */

export interface TokenAuthorities {
    bmbMintAuthority: LiteKeyPair;
    usdcMintAuthority: LiteKeyPair;
}

/**
 * Sets up token mint authorities for BMB and USDC.
 * Creates both mint authorities, airdrops 10 SOL to each, and creates the token mints.
 * 
 * @param lite - LiteDepin instance
 * @returns Object containing both mint authorities
 */
export async function setupTokens(lite: LiteDepin): Promise<TokenAuthorities> {
    // Generate mint authorities
    const bmbMintAuthority = await lite.generateKeyPair();
    const usdcMintAuthority = await lite.generateKeyPair();

    // Airdrop 10 SOL to both authorities
    await lite.airdrop(bmbMintAuthority, 10);
    await lite.airdrop(usdcMintAuthority, 10);

    // Create the token mints
    await lite.createToken(BMB_MINT, bmbMintAuthority, BMB_DECIMALS);
    await lite.createToken(getUsdcMint("devnet"), usdcMintAuthority, 6);  // USDC has 6 decimals

    return {
        bmbMintAuthority,
        usdcMintAuthority
    };
}

/**
 * Mints BMB tokens to a destination address.
 * 
 * @param lite - LiteDepin instance
 * @param destinationWallet - Address to receive the tokens
 * @param amount - Amount to mint (in base units, BMB has 9 decimals)
 * @param mintAuthority - BMB mint authority keypair
 * @returns Transaction result
 */
export async function mintBMB(
    lite: LiteDepin,
    destinationWallet: Address,
    amount: bigint,
    mintAuthority: LiteKeyPair
): Promise<TransactionResult> {
    return await lite.mintToken(BMB_MINT, destinationWallet, amount, mintAuthority);
}

/**
 * Mints USDC tokens to a destination address.
 * 
 * @param lite - LiteDepin instance
 * @param destinationWallet - Address to receive the tokens
 * @param amount - Amount to mint (in base units, USDC has 6 decimals)
 * @param mintAuthority - USDC mint authority keypair
 * @returns Transaction result
 */
export async function mintUSDC(
    lite: LiteDepin,
    destinationWallet: Address,
    amount: bigint,
    mintAuthority: LiteKeyPair
): Promise<TransactionResult> {
    return await lite.mintToken(USDC_MINT, destinationWallet, amount, mintAuthority);
}

/**
 * Gets the BMB token balance for a wallet.
 * 
 * @param lite - LiteDepin instance
 * @param walletAddress - Wallet address to check balance for
 * @returns Token balance in base units
 */
export async function getBMBBalance(
    lite: LiteDepin,
    walletAddress: Address
): Promise<bigint> {
    return await lite.getTokenBalance(BMB_MINT, walletAddress);
}

/**
 * Gets the USDC token balance for a wallet.
 * 
 * @param lite - LiteDepin instance
 * @param walletAddress - Wallet address to check balance for
 * @returns Token balance in base units
 */
export async function getUSDCBalance(
    lite: LiteDepin,
    walletAddress: Address
): Promise<bigint> {
    return await lite.getTokenBalance(USDC_MINT, walletAddress);
}


/**
 * Convenience function to convert USDC amount from token units to base units.
 * USDC has 6 decimals.
 * 
 * @param amount - Amount in USDC token units
 * @returns Amount in base units
*/
export function usdcToBaseUnits(amount: number): bigint {
    return BigInt(Math.floor(amount * 1_000_000));
}

/**
 * Convenience function to convert USDC base units to token units.
 * 
 * @param amount - Amount in base units
 * @returns Amount in USDC token units
 */
export function baseUnitsToUSDC(amount: bigint): number {
    return Number(amount) / 1_000_000;
}
