import { Codec, Endian, getStructCodec, getU64Codec } from "gill";

export interface PoolMetricsWeighted {
    total: bigint;
    total_weighted: bigint;
    total_opted_out: bigint;
    collected: bigint;
}

export const PoolMetricsWeightedCodec: Codec<PoolMetricsWeighted> = getStructCodec([
    ["total", getU64Codec({ endian: Endian.Little })],
    ["total_weighted", getU64Codec({ endian: Endian.Little })],
    ["total_opted_out", getU64Codec({ endian: Endian.Little })],
    ["collected", getU64Codec({ endian: Endian.Little })]
]);

export const POOL_METRICS_WEIGHTED_LEN = 32; // 4 * 8 bytes
