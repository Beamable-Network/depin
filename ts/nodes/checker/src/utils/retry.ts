import { sleep } from '@beamable-network/depin';
import { getLogger } from '../logger.js';

const logger = getLogger('RetryUtility');

export interface RetryOptions {
    maxRetries?: number;
    baseDelayMs?: number;
    exponentialBackoff?: boolean;
    shouldRetry?: (error: any) => boolean;
}

export interface RetryContext {
    attempt: number;
    maxRetries: number;
    lastError?: any;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
    maxRetries: 5,
    baseDelayMs: 2000, // 2 seconds (as requested by user)
    exponentialBackoff: false,
    shouldRetry: () => true,
};

/**
 * Executes a function with retry logic
 * @param fn The async function to execute
 * @param options Retry configuration options
 * @returns Promise that resolves with the function result or rejects after all retries are exhausted
 */
export async function withRetry<T>(
    fn: (context: RetryContext) => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const config = { ...DEFAULT_OPTIONS, ...options };

    let lastError: any;

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
        const context: RetryContext = {
            attempt,
            maxRetries: config.maxRetries,
            lastError,
        };

        try {
            const result = await fn(context);

            // Only log success if it took multiple attempts
            if (attempt > 1) {
                logger.info({ attempt, maxRetries: config.maxRetries },
                    `Operation succeeded on attempt ${attempt}/${config.maxRetries}`);
            }

            return result;
        } catch (error) {
            lastError = error;
            const isLastAttempt = attempt === config.maxRetries;

            // Check if we should retry this error
            if (!config.shouldRetry(error)) {
                logger.warn({ error, attempt }, 'Error marked as non-retryable, aborting');
                throw error;
            }

            logger.warn({ error, attempt, maxRetries: config.maxRetries },
                `Operation failed (attempt ${attempt}/${config.maxRetries})`);

            if (isLastAttempt) {
                logger.warn({ maxRetries: config.maxRetries },
                    `Operation failed after ${config.maxRetries} attempts`);
                throw error;
            }

            // Calculate delay with exponential backoff
            const delayMs = config.exponentialBackoff
                ? config.baseDelayMs * Math.pow(2, attempt - 1)
                : config.baseDelayMs;

            logger.debug({ attempt, delayMs, nextAttempt: attempt + 1, maxRetries: config.maxRetries },
                `Retrying in ${delayMs}ms (attempt ${attempt + 1}/${config.maxRetries})`);

            await sleep(delayMs);
        }
    }

    // This should never be reached, but TypeScript requires it
    throw lastError;
}