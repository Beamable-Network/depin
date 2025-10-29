import { Codec, Endian, getStructCodec, getU16Codec } from "gill";

export interface MonthlyPoolConfig {
    month_period: number;
    base_revenue_percentage: number;
    addon_revenue_percentage: number;
    base_emission_percentage: number;
}

export const MonthlyPoolConfigCodec: Codec<MonthlyPoolConfig> = getStructCodec([
    ["month_period", getU16Codec({ endian: Endian.Little })],
    ["base_revenue_percentage", getU16Codec({ endian: Endian.Little })],
    ["addon_revenue_percentage", getU16Codec({ endian: Endian.Little })],
    ["base_emission_percentage", getU16Codec({ endian: Endian.Little })]
]);

export const MONTHLY_POOL_CONFIG_LEN = 8; // 4 * 2 bytes
