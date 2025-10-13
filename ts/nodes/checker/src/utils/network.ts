import dns from 'dns';
import { promisify } from 'util';
import { Agent, request } from 'undici';
import { getLogger } from '../logger.js';
import { withRetry } from './retry.js';
import { AsyncCache } from './async-cache.js';

const logger = getLogger('NetworkUtility');
const resolve4 = promisify(dns.resolve4);

const ipCache = new AsyncCache<string, string>({
  max: 10,
  ttl: 60 * 1000, // 1 minute
});

export interface FetchExternalIpOptions {
  agent?: Agent;
  timeoutMs?: number;
  logContext?: Record<string, any>;
}

/**
 * Fetches the external IP address from checkip.amazonaws.com
 * @param options Configuration options
 * @returns Promise that resolves to the external IP address or null if it fails
 */
export async function fetchExternalIp(options: FetchExternalIpOptions = {}): Promise<string | null> {
  const { agent, timeoutMs = 10_000, logContext = {} } = options;
  
  return ipCache.get('externalIp', async () => {
    logger.debug(logContext, 'Fetching external IP from checkip.amazonaws.com');
    
    try {
      const ip = await withRetry(async ({ attempt }) => {
        const res = await request('https://checkip.amazonaws.com', {
          method: 'GET',
          dispatcher: agent,
          headersTimeout: timeoutMs,
          bodyTimeout: timeoutMs,
        });

        if (res.statusCode !== 200) {
          const error = new Error(`HTTP ${res.statusCode}`);
          logger.warn({ ...logContext, statusCode: res.statusCode, attempt }, 'Failed to fetch external IP');
          throw error;
        }

        const ip = (await res.body.text()).trim();
        return ip;
      }, {
        maxRetries: 5,
        baseDelayMs: 1000,
        exponentialBackoff: true
      });
      return ip;
    } catch (err) {
      logger.warn({ ...logContext, err: err instanceof Error ? err.message : String(err) }, 'Error fetching external IP after all retries');
      throw err;
    }
  });
}

export interface ResolveHostnameOptions {
  logContext?: Record<string, any>;
}

/**
 * Resolves a hostname to an IP address using DNS
 * @param hostname The hostname to resolve
 * @param options Configuration options
 * @returns Promise that resolves to the first IP address or null if it fails
 */
export async function resolveHostnameToIp(hostname: string, options: ResolveHostnameOptions = {}): Promise<string | null> {
  const { logContext = {} } = options;

  try {
    const ip = await withRetry(async ({ attempt }) => {
      const addresses = await resolve4(hostname);

      if (!addresses || addresses.length === 0) {
        const error = new Error('No IP addresses found');
        logger.warn({ ...logContext, hostname, attempt }, 'Failed to resolve hostname');
        throw error;
      }

      return addresses[0];
    }, {
      maxRetries: 5,
      baseDelayMs: 1000,
      exponentialBackoff: true
    });
    return ip;
  } catch (err) {
    logger.warn({ ...logContext, hostname, err: err instanceof Error ? err.message : String(err) }, 'Error resolving hostname after all retries');
    return null;
  }
}
