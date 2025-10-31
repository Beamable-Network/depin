import { getMonthStartTimestamp } from '@beamable-network/depin';
import { LiteDepin } from './lite-depin.js';

/**
 * Sets the clock to a specific month period in the test environment.
 * Month period 0 = June 2025, 1 = July 2025, etc.
 */
export function setMonthPeriod(lite: LiteDepin, monthPeriod: number): void {
    const timestamp = getMonthStartTimestamp(monthPeriod);
    lite.setTime(timestamp);
}