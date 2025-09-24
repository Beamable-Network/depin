import { findWorkerProofPDA, getCurrentPeriod, getRemainingTimeInPeriodMs, SubmitWorkerProof } from '@beamable-network/depin';
import { publicKey } from '@metaplex-foundation/umi';
import { getLogger } from '../logger.js';
import { withRetry } from '../utils/retry.js';
import { WorkerNode } from '../worker.js';
import { AggregatedProof, AggregatedProofProvider, S3AggregatedProofProvider } from './aggregated-proof-provider.js';
const { getAssetWithProof } = await import('@metaplex-foundation/mpl-bubblegum');

const logger = getLogger('ProofSubmitService');

export class ProofSubmitService {
  private static readonly MIN_DELAY_MS = 60_000; // 1 minute
  private static readonly MAX_DELAY_MS = 30 * 60_000; // 30 minutes
  private static readonly ERROR_RETRY_DELAY_MS = 60_000; // 1 minute
  private static readonly BUFFER_SLEEP_MS = 10_000; // 10 seconds - buffer time for various sleep operations
  private static readonly PERIOD_END_THRESHOLD_MS = 1430 * 60 * 1000; // 23h50m - threshold for early period processing

  private isRunning = false;
  private currentPeriod = 0;

  constructor(
    private readonly worker: WorkerNode,
    private readonly proofProvider: AggregatedProofProvider = new S3AggregatedProofProvider(worker)
  ) { }

  // Lifecycle Methods
  start(): void {
    if (this.isRunning) {
      logger.warn('ProofSubmitService is already running');
      return;
    }

    this.isRunning = true;
    logger.info({ currentPeriod: getCurrentPeriod() }, 'Starting ProofSubmitService');
    this.runLoop();
  }

  stop(): void {
    logger.info('Stopping ProofSubmitService');
    this.isRunning = false;
  }

  async runLoop(): Promise<void> {
    while (this.isRunning) {
      let period = getCurrentPeriod();

      if (period !== this.currentPeriod) {
        // Period has changed
        this.currentPeriod = period;

        if (getRemainingTimeInPeriodMs(period) > ProofSubmitService.PERIOD_END_THRESHOLD_MS) { // If more than 23h50m left in the period
          // Sleep for a random time between MIN_DELAY_MS minute and MAX_DELAY_MS
          const randomSleepTimeMs = ProofSubmitService.MIN_DELAY_MS + Math.floor(Math.random() * (ProofSubmitService.MAX_DELAY_MS - ProofSubmitService.MIN_DELAY_MS));
          logger.info({ period, randomSleepTimeMs }, 'Sleeping for a while');
          await this.sleep(randomSleepTimeMs);
        }
        while (true) {
          try {
            await this.runPeriodTasks(period);
            logger.info({ period }, 'Completed worker tasks for period');
            break;
          }
          catch (err) {
            if (period !== getCurrentPeriod()) {
              logger.fatal({ err, period }, 'Period changed, exiting retry loop');
              break;
            }
            else {
              logger.error({ err, period }, 'Period tasks failed, will retry');
              await this.sleep(ProofSubmitService.ERROR_RETRY_DELAY_MS);
            }
          }
        }
      }

      if (getRemainingTimeInPeriodMs() > ProofSubmitService.BUFFER_SLEEP_MS && this.currentPeriod === getCurrentPeriod()) {
        const remainingTime = getRemainingTimeInPeriodMs();
        const sleepTime = remainingTime + ProofSubmitService.BUFFER_SLEEP_MS; // 10 seconds buffer
        logger.info({ sleepTime }, 'Sleeping until next period');
        await this.sleep(sleepTime);
      }
      else {
        logger.info('Sleeping for 10 seconds before rechecking period');
        await this.sleep(ProofSubmitService.BUFFER_SLEEP_MS); // Check again in 10 seconds
      }
    }
  }

  private async runPeriodTasks(period: number): Promise<void> {
    await withRetry(async () => {
      if (!this.isRunning) {
        throw new Error('Service is not running');
      }

      const proof = await this.proofProvider.getAggregatedProof(period);
      if (!proof) {
        logger.warn({ period }, `No proof data available for period ${period}`);
        return;
      }

      await this.submitProof(period, proof);
    }, {
      maxRetries: 5,
      baseDelayMs: 10_000, // 10 seconds
      exponentialBackoff: true,
      shouldRetry: (error: any) => {
        // Don't retry if service is stopped
        if (error instanceof Error && error.message === 'Service is not running') {
          return false;
        }
        return true;
      }
    });

  }

  private async submitProof(period: number, proof: AggregatedProof): Promise<void> {
    logger.info({ period }, 'Submitting proof');

    const licenseAsset = await getAssetWithProof(this.worker.getUmi(), publicKey(this.worker.getLicense()));

    const instruction = new SubmitWorkerProof({
      payer: this.worker.getSigner(),
      worker_license: licenseAsset,
      proof_root: proof.proofRoot,
      checkers: proof.checkers,
      period,
      latency: proof.latency,
      uptime: proof.uptime,
    });

    try {
      const { signature } = await this.worker.getRpcClient().buildAndSendTransaction(
        [await instruction.getInstruction()],
        'finalized'
      );

      // Count set bits in checkers bitmap for observability
      let setBits = 0;
      for (const b of proof.checkers) {
        let v = b;
        while (v) { setBits += v & 1; v >>= 1; }
      }

      logger.info({ period, txSig: signature, setCheckers: setBits }, '✅ Proof submitted');
    }
    catch (err) {
      if (err instanceof Error && err.message.includes('AccountAlreadyInitialized')) {
        logger.warn({ period }, 'Proof already initialized');
      }
      else {
        throw err;
      }
    }

  }

  // Proof Verification
  private async isProofAlreadySubmitted(period: number): Promise<boolean> {
    try {
      const [pda] = await findWorkerProofPDA(this.worker.getLicense(), period);
      const account = await this.worker.getUmi().rpc.getAccount(publicKey(pda));
      return account.exists;
    } catch (err) {
      logger.warn(err, `Error checking existing proof for period ${period}`);
      return false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
  }
}
