import dns from 'dns';
import net from "node:net";
import { promisify } from 'util';
import { getLogger } from '../logger.js';
import { withRetry } from './retry.js';

const logger = getLogger('NetworkUtility');
const resolve4 = promisify(dns.resolve4);

export interface ResolveHostnameOptions {
  logContext?: Record<string, any>;
}

/**
 * Resolves a hostname to all IP addresses using DNS
 * @param hostname The hostname to resolve
 * @param options Configuration options
 * @returns Promise that resolves to an array of IP addresses or null if it fails
 */
export async function resolveHostnameToIps(hostname: string, options: ResolveHostnameOptions = {}): Promise<string[] | null> {
  const { logContext = {} } = options;

  try {
    const ips = await withRetry(async ({ attempt }) => {
      const addresses = await resolve4(hostname);

      if (!addresses || addresses.length === 0) {
        const error = new Error('No IP addresses found');
        logger.warn({ ...logContext, hostname, attempt }, 'Failed to resolve hostname');
        throw error;
      }
      return addresses;
    }, {
      maxRetries: 5,
      baseDelayMs: 1000,
      exponentialBackoff: true
    });
    return ips;
  } catch (err) {
    logger.warn({ ...logContext, hostname, err: err instanceof Error ? err.message : String(err) }, 'Error resolving hostname after all retries');
    return null;
  }
}

export function isPrivateIP(ip: string) {
  if (!net.isIP(ip)) return false;

  // IPv4 private ranges
  const parts = ip.split('.').map(Number);
  if (parts.length === 4) {
    const [a, b] = parts;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
  }

  // IPv6 private prefixes
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // Unique local
  if (ip === "::1") return true; // loopback
  if (ip.startsWith("fe80")) return true; // link-local

  return false;
}