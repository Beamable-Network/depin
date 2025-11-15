import dns from 'dns';
import { promisify } from 'util';
import { Agent, request } from 'undici';
import { getLogger } from '../logger.js';
import { withRetry } from './retry.js';
import { AsyncCache } from './async-cache.js';

const logger = getLogger('NetworkUtility');
const lookup = promisify(dns.lookup);

const ipCache = new AsyncCache<string, string>({
  max: 10,
  ttl: 60 * 1000, // 1 minute
});

export interface FetchExternalIpOptions {
  agent?: Agent;
  timeoutMs?: number;
  logContext?: Record<string, any>;
}

// List of reliable external IP resolution services (in order of preference)
const IP_SERVICES = [
  'https://checkip.amazonaws.com',
  'https://api.ipify.org',
  'https://a.ident.me/',
];

/**
 * Fetches the external IP address from multiple reliable services with automatic fallback
 * @param options Configuration options
 * @returns Promise that resolves to the external IP address or null if all services fail
 */
export async function fetchExternalIp(options: FetchExternalIpOptions = {}): Promise<string | null> {
  const { agent, timeoutMs = 5_000, logContext = {} } = options;

  return ipCache.get('externalIp', async () => {
    const errors: Array<{ service: string; error: string }> = [];

    // Try each service in order until one succeeds
    for (const serviceUrl of IP_SERVICES) {
      try {
        const ip = await withRetry(async ({ attempt }) => {
          const res = await request(serviceUrl, {
            method: 'GET',
            dispatcher: agent,
            headersTimeout: timeoutMs,
            bodyTimeout: timeoutMs,
          });

          if (res.statusCode !== 200) {
            const error = new Error(`HTTP ${res.statusCode}`);
            logger.warn({ ...logContext, service: serviceUrl, statusCode: res.statusCode, attempt }, 'Failed to fetch external IP');
            throw error;
          }

          const ip = (await res.body.text()).trim();
          return ip;
        }, {
          maxRetries: 2,
          baseDelayMs: 100,
          exponentialBackoff: false
        });

        return ip;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push({ service: serviceUrl, error: errorMsg });
        logger.warn({ ...logContext, service: serviceUrl, err: errorMsg }, 'Service failed, trying next service');
      }
    }

    // All services failed
    logger.error({ ...logContext, errors }, 'All IP services failed');
    throw new Error(`Failed to fetch external IP from all services: ${errors.map(e => `${e.service} (${e.error})`).join(', ')}`);
  });
}

export interface ResolveHostnameOptions {
  logContext?: Record<string, any>;
  timeoutMs?: number;
}

/**
 * Resolves a hostname to an IP address using OS-level DNS resolution
 * Uses dns.lookup() which respects system configuration and returns IPv4 or IPv6
 * based on OS preferences. This is more similar to how standard applications resolve hostnames.
 * @param hostname The hostname to resolve
 * @param options Configuration options
 * @returns Promise that resolves to the IP address or null if it fails
 */
export async function resolveHostnameToIp(hostname: string, options: ResolveHostnameOptions = {}): Promise<string | null> {
  const { logContext = {}, timeoutMs = 5000 } = options;

  try {
    const ip = await withRetry(async ({ attempt }) => {
      // Wrap DNS lookup with timeout to prevent indefinite hangs
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DNS lookup timeout')), timeoutMs)
      );

      const lookupPromise = lookup(hostname);
      const result = await Promise.race([lookupPromise, timeoutPromise]);

      if (!result || !result.address) {
        const error = new Error(`No IP address found for hostname ${hostname}`);
        logger.warn({ ...logContext, hostname, attempt }, 'Failed to resolve hostname');
        throw error;
      }
      return result.address;
    }, {
      maxRetries: 3,
      baseDelayMs: 500,
      exponentialBackoff: true
    });
    return ip;
  } catch (err) {
    logger.warn({ ...logContext, hostname, err: err instanceof Error ? err.message : String(err) }, 'Error resolving hostname after all retries');
    return null;
  }
}