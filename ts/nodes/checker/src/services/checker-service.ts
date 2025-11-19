import { BMBStateAccount, getCurrentPeriod, getPeriodEndMs, getRemainingTimeInPeriodMs, ProgramAccount, runBrand, WorkerMetadataAccount } from '@beamable-network/depin';
import { promiseStateAsync } from 'p-state';
import { setMaxListeners } from 'events';
import { CheckerNode } from '../checker.js';
import { getLogger } from '../logger.js';
import { AsyncCache } from '../utils/async-cache.js';
import { HealthCheckManager, HealthCheckTarget } from './health-check-service.js';
import { ResolvedWorkerDiscovery, WorkerDiscoveryService } from './worker-discovery-service.js';

const logger = getLogger('CheckerService');

// Global cache for BMB state with 24h TTL
const bmbStateCheckerCountCache = new AsyncCache<string, number>({
  max: 100,
  ttl: 24 * 60 * 60 * 1000, // 24 hours
});

export class CheckerService {
  private static readonly MIN_DELAY_MS = 60_000; // 1 minute
  private static readonly MAX_DELAY_MS = 60 * 60_000; // 1 hour
  private static readonly PERIOD_END_THRESHOLD_MS = 1430 * 60 * 1000; // 23h50m - threshold for early period processing
  private static readonly PERIOD_SKIP_THRESHOLD_MS = 60 * 60 * 1000; // 1h - threshold for skipping periods
  private static readonly BUFFER_SLEEP_MS = 10_000; // 10 seconds - buffer time for various sleep operations
  private static readonly ERROR_RETRY_DELAY_MS = 60_000; // 1 minute
  private static readonly HEALTH_ABORT_THRESHOLD_MS = 20 * 60 * 1000; // abort health checks 20 minutes before period end

  private isRunning = false;
  private currentPeriod = 0;
  
  public readonly discoveryService: WorkerDiscoveryService;

  constructor(private readonly checker: CheckerNode) {
    this.discoveryService = new WorkerDiscoveryService(this.checker);
  }

  get logContext() {
    return {
      checker: {
        license: this.checker.license.address,
        index: this.checker.license.index
      }
    };
  }
  
  private async getCheckerCount(period: number): Promise<number> {
    return bmbStateCheckerCountCache.get(`period-${period}`, async () => {
      logger.debug({ ...this.logContext, period }, 'Fetching BMB state from RPC');
      const bmbState = await BMBStateAccount.readFromState(async (address) => {
        const accountDataBytes = await this.checker.getRpcClient().getAccount(address);
        if (!accountDataBytes) return null;
        return accountDataBytes;
      });

      const count = bmbState?.data.getCheckerCountForPeriod(period);

      if (!count) {
        throw new Error(`No checker count found for period ${period}`);
      }

      return count;
    });
  }

  start(): void {
    if (this.isRunning) {
      logger.warn({ ...this.logContext }, 'CheckerService is already running');
      return;
    }

    this.isRunning = true;
    logger.info({ ...this.logContext }, 'Starting CheckerService');

    this.runLoop();
  }  

  async runLoop(): Promise<void> {
    while (this.isRunning) {
      let period = getCurrentPeriod();

      if (period !== this.currentPeriod) {
        // Period has changed
        this.currentPeriod = period;

        const remainingMs = getRemainingTimeInPeriodMs(period);

        if (remainingMs < CheckerService.PERIOD_SKIP_THRESHOLD_MS) {
          logger.warn({ ...this.logContext, period, remainingMs }, 'Skipping period tasks due to insufficient remaining time');
          const sleepTime = remainingMs + CheckerService.BUFFER_SLEEP_MS;
          logger.info({ ...this.logContext, sleepTime }, 'Sleeping until next period');
          await this.sleep(sleepTime);
          continue;
        }

        if (remainingMs > CheckerService.PERIOD_END_THRESHOLD_MS) { // If more than 23h50m left in the period
          // Sleep for a random time between MIN_DELAY_MS minute and MAX_DELAY_MS
          const randomSleepTimeMs = CheckerService.MIN_DELAY_MS + Math.floor(Math.random() * (CheckerService.MAX_DELAY_MS - CheckerService.MIN_DELAY_MS));
          logger.info({ ...this.logContext, period, randomSleepTimeMs }, 'Sleeping for a while');
          await this.sleep(randomSleepTimeMs);
        }
        while (true) {
          try {
            await this.runPeriodTasks(period);
            logger.info({ ...this.logContext, period }, 'Completed checker tasks for period');
            break;
          }
          catch (err) {
            if (period !== getCurrentPeriod()) {
              logger.fatal({ ...this.logContext, err, period }, 'Period changed, exiting retry loop');
              break;
            }
            else {
              if (err instanceof Error && err.name === 'AbortError') {
                logger.warn({ ...this.logContext, err, period }, 'Operation aborted, exiting retry loop');
                break;
              }
              else {
                logger.error({ ...this.logContext, err, period, retryMs: CheckerService.ERROR_RETRY_DELAY_MS }, 'Period tasks failed, will retry');
                await this.sleep(CheckerService.ERROR_RETRY_DELAY_MS);
              }
            }
          }
        }
      }

      if (getRemainingTimeInPeriodMs(this.currentPeriod) > CheckerService.BUFFER_SLEEP_MS && this.currentPeriod === getCurrentPeriod()) {
        const remainingTime = getRemainingTimeInPeriodMs(this.currentPeriod);
        const sleepTime = remainingTime + CheckerService.BUFFER_SLEEP_MS; // 10 seconds buffer
        logger.info({ ...this.logContext, sleepTime }, 'Sleeping until next period');
        await this.sleep(sleepTime);
      }
      else {
        logger.info({ ...this.logContext }, 'Sleeping for 10 seconds before rechecking period');
        await this.sleep(CheckerService.BUFFER_SLEEP_MS); // Check again in 10 seconds
      }
    }
  }

  private async runPeriodTasks(period: number): Promise<void> {
    logger.info({ ...this.logContext, period }, 'Running checker tasks');

    const checkerCount = await this.getCheckerCount(period);

    const myLicenseIndex = this.checker.license.index;

    const activeWorkerAccounts = await this.discoveryService.fetchActiveWorkerAccounts();
    logger.info({ ...this.logContext, period, activeWorkers: activeWorkerAccounts.length }, 'Fetched active worker accounts');

    let eligibleWorkers = activeWorkerAccounts;
    if (!this.checker.skipBrand()) {
      eligibleWorkers = activeWorkerAccounts.filter(worker => this.isWorkerEligible(myLicenseIndex, worker.data, period, checkerCount));
    }

    if (eligibleWorkers.length === 0) {
      logger.warn({ ...this.logContext, period }, 'No eligible workers found for this period');
      return;
    }

    // Prepare health check manager and controller for this period
    const healthManager = new HealthCheckManager(this.checker);
    const healthAc = new AbortController();
    setMaxListeners(100_000, healthAc.signal);
    const periodEndAt = getPeriodEndMs(period);

    try {
      await this.resolveWorkers(eligibleWorkers, period, (entry) => {
        logger.info({
          ...this.logContext,
          period,
          worker: {
            address: entry.workerAccount.data.delegatedTo,
            license: entry.workerAccount.data.license
          },
          discoveryUri: entry.workerAccount.data.discoveryUri
        }, 'Worker resolved');
        // Start health check session for this worker
        healthManager.startSession(
          new HealthCheckTarget({
            workerAccount: entry.workerAccount,
            discovery: entry.discovery,
            period,
          }),
          {
            periodEndAt,
            signal: healthAc.signal,
          }
        );
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        logger.warn({ ...this.logContext, period }, 'Discovery aborted; continuing with any resolved workers');
      } else {
        logger.warn({ ...this.logContext, err, period }, 'Discovery errored; continuing with any resolved workers');
      }
    }

    // After discovery, wait for all health checks; abort HEALTH_ABORT_THRESHOLD_MS before period end
    const healthPromise = healthManager.waitForAll();
    const healthTimer = setTimeout(async () => {
      const state = await promiseStateAsync(healthPromise);
      if (state === 'pending') {
        logger.fatal({ ...this.logContext, period }, 'Health checks taking too long, aborting remaining checks');
        healthAc.abort('Aborting health checks, period ending soon');
      }
    }, Math.max(0, getRemainingTimeInPeriodMs(period) - CheckerService.HEALTH_ABORT_THRESHOLD_MS));

    try {
      await healthPromise;
    }
    finally {
      clearTimeout(healthTimer);
      await healthManager.close();
    }
  }

  private async resolveWorkers(eligibleWorkers: ProgramAccount<WorkerMetadataAccount>[], period: number, onResolved: (entry: ResolvedWorkerDiscovery) => void): Promise<void> {
    const discoveryAc = new AbortController();
    setMaxListeners(100_000, discoveryAc.signal);

    const remainingTimeMs = getRemainingTimeInPeriodMs(period);

    const resolvePromise = this.discoveryService.resolve({
      workerAccounts: eligibleWorkers,
      period,
      onResolved: (entry) => onResolved(entry),
      signal: discoveryAc.signal
    });

    const timer = setTimeout(async () => {
      const state = await promiseStateAsync(resolvePromise);
      if (state === 'pending') {
        logger.debug({ ...this.logContext, period }, 'Worker resolution taking too long, aborting');
        discoveryAc.abort('Aborting worker resolution due to period ending soon');
      }
    }, Math.max(0, remainingTimeMs - CheckerService.PERIOD_SKIP_THRESHOLD_MS)); // Abort worker resolution if less than PERIOD_SKIP_THRESHOLD_MS remains in the period

    try {
      await resolvePromise;
    } finally {
      clearTimeout(timer);
    }
  }



  private isWorkerEligible(myLicenseIndex: number, worker: WorkerMetadataAccount, period: number, periodCheckers: number): boolean {
    const brandOutput = runBrand(worker.license, period, periodCheckers);
    return brandOutput.includes(myLicenseIndex);
  }

  stop(): void {
    logger.info({ ...this.logContext }, 'Stopping CheckerService');
    this.isRunning = false;
  }

  private sleep(ms: number): Promise<void> {
    return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
  }
}
