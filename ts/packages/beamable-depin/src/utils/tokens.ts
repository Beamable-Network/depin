import { BMB_DECIMALS } from "../constants.js";

/**
 * Convenience function to convert BMB amount from token units to base units.
 * 
 * @param amount - Amount in BMB token units
 * @returns Amount in base units (lamports)
 */
export function bmbToBaseUnits(amount: number): bigint {
    return BigInt(Math.floor(amount * 10 ** BMB_DECIMALS));
}

/**
 * Convenience function to convert BMB base units to token units.
 * 
 * @param amount - Amount in base units
 * @returns Amount in BMB token units
 */
export function baseUnitsToBMB(amount: bigint): number {
    return Number(amount) / 10 ** BMB_DECIMALS;
}