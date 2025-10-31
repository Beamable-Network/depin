const PERIOD_ZERO = 1748736000; // 2025-06-01 00:00:00 UTC

export function getCurrentPeriod(): number {
    const now = Math.floor(Date.now() / 1000); // Current Unix timestamp in seconds
    return timestampToPeriod(BigInt(now));
}

export function periodToTimestamp(period: number): bigint {
    if (period < 0) {
        throw new Error("Period cannot be negative");
    }
    
    if (period > 65535) { // u16::MAX = 65535
        throw new Error("Period exceeds u16::MAX");
    }

    // Convert period (days) back to Unix timestamp
    const secondsFromStart = period * 86400; // 86400 seconds in a day
    return BigInt(PERIOD_ZERO + secondsFromStart);
}

export function timestampToPeriod(timestamp: bigint): number {
    if (timestamp < PERIOD_ZERO) {
        return 0;
    }

    const secondsSinceStart = timestamp - BigInt(PERIOD_ZERO);
    const daysSinceStart = Math.floor(Number(secondsSinceStart / BigInt(86400)));

    if (daysSinceStart > 65535) { // u16::MAX = 65535
        throw new Error("Period exceeds u16::MAX");
    }

    return daysSinceStart;
}

/**
 * Returns remaining time in the specified period in milliseconds.
 * If no period is provided, uses the current period.
 */
export function getRemainingTimeInPeriodMs(period?: number): number {
    const nowMs = Date.now();
    const targetPeriod = period ?? getCurrentPeriod();
    const endSec = periodToTimestamp(targetPeriod + 1);
    const endMs = Number(endSec * BigInt(1000));
    const remaining = endMs - nowMs;
    return remaining > 0 ? remaining : 0;
}

/**
 * Returns the epoch milliseconds for the end of the given period.
 * Periods are daily windows starting at 2025-06-01 00:00:00 UTC (PERIOD_ZERO).
 * The end of period N is the start of period N+1.
 */
export function getPeriodEndMs(period: number): number {
    if (period < 0) throw new Error('Period cannot be negative');
    const endSec = periodToTimestamp(period + 1);
    return Number(endSec * BigInt(1000));
}


/**
 * Calculates the Unix timestamp for the start of a given month period.
 * Month period 0 = June 2025, 1 = July 2025, etc.
 *
 * This mirrors the Rust function get_month_start_timestamp.
 */
export function getMonthStartTimestamp(monthPeriod: number): bigint {
    if (monthPeriod === 0) {
        return BigInt(PERIOD_ZERO);
    }

    // Convert month_period to calendar year and month
    const monthOffset = monthPeriod;
    const totalMonths = 5 + monthOffset; // 5 = June (0-indexed from January)
    const year = 2025 + Math.floor(totalMonths / 12);
    const month = (totalMonths % 12) + 1;

    // Civil calendar algorithm: days_from_civil(year, month, 1)
    const y = month <= 2 ? year - 1 : year;
    const era = y >= 0 ? Math.floor(y / 400) : Math.floor((y - 399) / 400);
    const yoe = y - era * 400;
    const mAdj = month > 2 ? month - 3 : month + 9;
    const doy = Math.floor((153 * mAdj + 2) / 5);
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    const daysSinceEpoch = era * 146097 + doe - 719468;

    return BigInt(daysSinceEpoch * 86400);
}