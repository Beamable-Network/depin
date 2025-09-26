import { ProgramAccount, WorkerDiscoveryDocument, WorkerMetadataAccount, sleep, SignedPayload, WorkerHealthCheckRequestPayloadSchema } from '@beamable-network/depin';
import pLimit from 'p-limit';
import { Agent, request } from 'undici';
import { getLogger } from '../logger.js';
import { CheckerNode } from '../checker.js';

const logger = getLogger('HealthCheckService');

export interface HealthCheckTarget {
  workerAccount: ProgramAccount<WorkerMetadataAccount>;
  discovery: WorkerDiscoveryDocument;
  period: number;
}

export interface IHealthCheckMetrics {
  samples: number;
  success: number;
  failure: number;
  avgLatencyMs: number;
  uptimePercent: number;
}

export interface StartSessionOptions {
  periodEndAt: number; // epoch ms; end of the period window
  signal?: AbortSignal; // external abort signal (managed by checker-service like discoveryAc)
  minIntervalMs?: number; // default 10 minutes
  maxIntervalMs?: number; // default 30 minutes
}

export const defaultSessionOptions = (periodEndAt: number): StartSessionOptions => ({
  periodEndAt,
  minIntervalMs: 10 * 60_000, // 10 minutes
  maxIntervalMs: 30 * 60_000, // 30 minutes
});

export interface HealthCheckConfig {
  concurrency?: number;
  httpTimeoutMs?: number;
  keepAliveMaxTimeout?: number;
  keepAliveTimeout?: number;
  maxConnections?: number;
}

export class HealthCheckManager {
  static readonly DEFAULT_CONFIG: HealthCheckConfig = {
    concurrency: 10,
    httpTimeoutMs: 10_000,
    keepAliveMaxTimeout: 30_000,
    keepAliveTimeout: 10_000,
    maxConnections: 64,
  };

  private readonly limit: <T>(fn: () => Promise<T>) => Promise<T>;
  private readonly agent: Agent;
  private readonly sessions = new Set<Promise<void>>();

  constructor(private readonly checker: CheckerNode, config: Partial<HealthCheckConfig> = {}) {
    const fullConfig = { ...HealthCheckManager.DEFAULT_CONFIG, ...config };
    this.limit = pLimit(fullConfig.concurrency!);
    this.agent = new Agent({
      keepAliveMaxTimeout: fullConfig.keepAliveMaxTimeout,
      headersTimeout: fullConfig.httpTimeoutMs,
      bodyTimeout: fullConfig.httpTimeoutMs,
      keepAliveTimeout: fullConfig.keepAliveTimeout,
      connections: fullConfig.maxConnections,
    });
  }

  startSession(target: HealthCheckTarget, options: Partial<StartSessionOptions>): void {
    const fullOptions: StartSessionOptions = {
      ...defaultSessionOptions(options.periodEndAt!),
      ...options,
    };
    logger.debug({ 
      worker: target.discovery.worker.address, 
      period: target.period,
      periodEndAt: new Date(fullOptions.periodEndAt).toISOString(),
      minIntervalMs: fullOptions.minIntervalMs,
      maxIntervalMs: fullOptions.maxIntervalMs
    }, 'Starting health check session');
    const session = new HealthCheckSession(target, this.agent, this.limit, fullOptions, this.checker);
    const promise = session.run()
      .catch(err => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          logger.info({ worker: target.discovery.worker.address, period: target.period }, 'Health check session aborted');
          return;
        }
        logger.warn({ err, worker: target.discovery.worker.address, period: target.period }, 'Health check session ended with error');
      })
      .finally(() => this.sessions.delete(promise));
    this.sessions.add(promise);
  }

  async waitForAll(): Promise<void> {
    const sessionCount = this.sessions.size;
    if (sessionCount > 0) {
      await Promise.all(Array.from(this.sessions));
    }
  }

  async close(): Promise<void> {
    logger.info('Closing health check manager');
    try {
      await this.agent.close();
      logger.debug('HTTP agent closed successfully');
    } catch (err) {
      logger.warn({ err }, 'Error closing HTTP agent; ignoring');
    }
  }
}

class HealthCheckMetrics {
  samples = 0;
  success = 0;
  failure = 0;
  avgLatencyMs = 0;

  update(latency: number, isSuccess: boolean): void {
    this.samples += 1;
    this.success += isSuccess ? 1 : 0;
    this.failure += isSuccess ? 0 : 1;
    this.avgLatencyMs += (latency - this.avgLatencyMs) / this.samples;
  }

  get uptimePercent(): number {
    return this.samples > 0 ? (this.success / this.samples) * 100 : 0;
  }

  toJSON(): IHealthCheckMetrics {
    return {
      samples: this.samples,
      success: this.success,
      failure: this.failure,
      avgLatencyMs: this.avgLatencyMs,
      uptimePercent: this.uptimePercent,
    };
  }
}

class HealthCheckSession {
  private static readonly MIN_EARLY_MS = 30 * 60_000; // 30 minutes
  private static readonly MAX_EARLY_MS = 4 * 60 * 60_000; // 4 hours
  private static readonly DEFAULT_MIN_INTERVAL_MS = 10 * 60_000; // 10 minutes
  private static readonly DEFAULT_MAX_INTERVAL_MS = 30 * 60_000; // 30 minutes

  private readonly metrics = new HealthCheckMetrics();
  private get logContext() {
    return { worker: this.target.discovery.worker.address, period: this.target.period };
  }

  constructor(
    private readonly target: HealthCheckTarget,
    private readonly agent: Agent,
    private readonly limit: <T>(fn: () => Promise<T>) => Promise<T>,
    private readonly opts: StartSessionOptions,
    private readonly checker: CheckerNode,
  ) { }

  async run(): Promise<void> {
    const { signal } = this.opts;
    const { discovery } = this.target;

    if (!discovery.endpoints.health?.trim()) {
      logger.warn(this.logContext, 'No health endpoint; skipping session');
      return;
    }

    const sessionCutoffAt = this.calculateSessionCutoff();
    const sessionDurationMs = sessionCutoffAt - Date.now();
    logger.debug({ 
      ...this.logContext, 
      sessionCutoffAt: new Date(sessionCutoffAt).toISOString(),
      sessionDurationMs,
      sessionDurationMinutes: Math.round(sessionDurationMs / 60_000)
    }, 'Health check session timing calculated');
    
    try {
      await this.runHealthCheckLoop(sessionCutoffAt, signal);
    } finally {
      await this.buildAndSendSignedProof();
    }
  }

  private calculateSessionCutoff(): number {
    const { periodEndAt } = this.opts;
    const minRunWindow = this.opts.minIntervalMs ?? HealthCheckSession.DEFAULT_MIN_INTERVAL_MS;

    // Calculate a random early stop time between 30 minutes and 4 hours before period end
    // This spreads out checker submissions to prevent network congestion
    const earlyTimeRange = Math.max(0, HealthCheckSession.MAX_EARLY_MS - HealthCheckSession.MIN_EARLY_MS);
    const randomEarlyOffset = HealthCheckSession.MIN_EARLY_MS + Math.floor(Math.random() * (earlyTimeRange + 1));
    
    // Set boundaries for when the session can end
    const latestAllowedCutoff = periodEndAt - HealthCheckSession.MIN_EARLY_MS; // Never later than 30 min before period end
    const randomizedCutoff = periodEndAt - randomEarlyOffset; // The randomly calculated cutoff time
    const earliestAllowedCutoff = Date.now() + minRunWindow; // Must run for at least minRunWindow duration
    
    // Apply constraints: ensure we run for minimum time, but never past the safety boundary
    // If checker starts late, it will be forced to end at latestAllowedCutoff
    return Math.min(
      latestAllowedCutoff, // Hard limit: 30 min before period end
      Math.max(randomizedCutoff, earliestAllowedCutoff)  // Use random cutoff unless it's too early
    );
  }

  private async runHealthCheckLoop(cutoffAt: number, signal?: AbortSignal): Promise<void> {
    logger.debug({ ...this.logContext, cutoffAt: new Date(cutoffAt).toISOString() }, 'Starting health check loop');
    
    const executeHealthCheck = async () => {
      signal?.throwIfAborted();
      await this.limit(async () => this.performCheck(signal).catch(err => {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        logger.warn({ ...this.logContext, err }, 'Health check request error');
      }));
    };

    // Perform the first check immediately
    if (Date.now() < cutoffAt) {
      await executeHealthCheck();
    }

    // Continue with delayed checks
    while (Date.now() < cutoffAt) {
      signal?.throwIfAborted();
      const delay = this.calculateNextDelay(cutoffAt);
      if (delay <= 0) break;

      logger.debug({ ...this.logContext, delayMs: delay }, 'Waiting before next health check');
      await sleep(delay, signal);
      await executeHealthCheck();
    }

    logger.debug(this.logContext, 'Reached session cutoff; ending health checks');
  }

  private calculateNextDelay(cutoffAt: number): number {
    const timeLeft = Math.max(0, cutoffAt - Date.now());
    return Math.min(this.nextIntervalMs(), timeLeft);
  }

  private nextIntervalMs(): number {
    const min = this.opts.minIntervalMs ?? HealthCheckSession.DEFAULT_MIN_INTERVAL_MS;
    const max = this.opts.maxIntervalMs ?? HealthCheckSession.DEFAULT_MAX_INTERVAL_MS;
    const span = Math.max(0, max - min);
    return min + Math.floor(Math.random() * (span + 1));
  }

  private async performCheck(signal?: AbortSignal): Promise<void> {
    const { discovery } = this.target;
    const url = discovery.endpoints.health;
    
    try {
      // Create signed health check request
      const signedRequest = await SignedPayload.create<typeof WorkerHealthCheckRequestPayloadSchema>(
        {
          checker: this.checker.getAddress(),
          timestamp: Date.now(),
        },
        this.checker.getSigner()
      );

      const start = Date.now();

      const res = await request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(signedRequest),
        dispatcher: this.agent,
        headersTimeout: HealthCheckManager.DEFAULT_CONFIG.httpTimeoutMs,
        bodyTimeout: HealthCheckManager.DEFAULT_CONFIG.httpTimeoutMs,
        signal,
      });
      await res.body.text().catch(err => {
        logger.debug({ ...this.logContext, err }, 'Failed to read response body; ignoring');
      });
      const latency = Date.now() - start;
      const isSuccess = res.statusCode === 200;
      this.metrics.update(latency, isSuccess);
      
      logger.info({ 
        ...this.logContext, 
        statusCode: res.statusCode, 
        latencyMs: latency, 
        success: isSuccess,
        url
      }, 'Health check completed');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      this.metrics.update(0, false);
      logger.debug({ 
        ...this.logContext, 
        err: err instanceof Error ? err.message : String(err),
        url
      }, 'Health check failed with exception');
    }
  }

  private async buildAndSendSignedProof(): Promise<void> {
    const metricsSnapshot = this.metrics.toJSON();
    
    if (metricsSnapshot.samples > 0) {
      logger.debug({ 
        ...this.logContext, 
        ...metricsSnapshot
      }, 'Building signed proof from health check metrics');
      
      // Construct and send the signed proof
      // TODO: Implement proof construction and sending
    } else {
      logger.warn({ ...this.logContext }, 'No health check samples collected; skipping proof');
    }
  }
}