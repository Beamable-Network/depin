import { Codec, Endian, getI64Codec, getStructCodec, getU16Codec, getU64Codec } from "gill";

export interface StakeEntry {
    amount: bigint;
    timestamp: bigint;
    month_period: number;
    checker_count: number;
}

export const StakeEntryCodec: Codec<StakeEntry> = getStructCodec([
    ["amount", getU64Codec({ endian: Endian.Little })],
    ["timestamp", getI64Codec({ endian: Endian.Little })],
    ["month_period", getU16Codec({ endian: Endian.Little })],
    ["checker_count", getU16Codec({ endian: Endian.Little })]
]);

export const STAKE_ENTRY_LEN = 20; // 8 + 8 + 2 + 2 bytes
