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
