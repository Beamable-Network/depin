import { findWorkerProofPDA, getCurrentPeriod, getRemainingTimeInPeriodMs, SubmitWorkerProof } from '@beamable-network/depin';
import { publicKey } from '@metaplex-foundation/umi';
import { WorkerNode } from '../worker.js';
import { AggregatedProof, AggregatedProofProvider, S3AggregatedProofProvider } from './aggregated-proof-provider.js';
import { createLogger } from '../logger.js';
const { getAssetWithProof } = await import('@metaplex-foundation/mpl-bubblegum');

const logger = createLogger('ProofSubmitService');

export class ProofSubmitService {
  private static readonly MIN_DELAY_MS = 60_000; // 1 minute
  private static readonly MAX_RANDOM_DELAY_MS = 30 * 60_000; // 30 minutes
  private static readonly ERROR_RETRY_DELAY_MS = 60_000; // 1 minute

  private isRunning = false;

  constructor(
    private readonly worker: WorkerNode,
    private readonly proofProvider: AggregatedProofProvider = new S3AggregatedProofProvider(worker)
  ) { }

  // Lifecycle Methods
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('ProofSubmitService is already running');
      return;
    }

    this.isRunning = true;
    logger.info({ currentPeriod: getCurrentPeriod() }, 'Starting ProofSubmitService');
    this.runProofSubmissionLoop();
  }

  stop(): void {
    logger.info('Stopping ProofSubmitService');
    this.isRunning = false;
  }

  // Main Loop
  private async runProofSubmissionLoop(): Promise<void> {
    // Submit proof for the previous period on startup
    let currentPeriod = getCurrentPeriod();
    logger.debug({ currentPeriod }, 'Proof loop initialized');
    if (currentPeriod > 0) {
      await this.submitProofForPeriod(currentPeriod - 1, true);
    }

    // Start the periodic submission loop
    while (this.isRunning) {
      currentPeriod = getCurrentPeriod();
      const timeToNextPeriod = getRemainingTimeInPeriodMs(currentPeriod);

      logger.info({ currentPeriod, seconds: Math.round(timeToNextPeriod / 1000), nextPeriod: currentPeriod + 1 }, 'Waiting until next period');
      await this.sleep(timeToNextPeriod);

      currentPeriod = getCurrentPeriod();

      if (this.isRunning && currentPeriod > 0) {
        await this.submitProofForPeriod(currentPeriod - 1, false);
      }
    }
  }

  // Proof Submission
  private async submitProofForPeriod(period: number, isStartup: boolean): Promise<void> {
    try {
      const currentPeriod = getCurrentPeriod();
      logger.info({ period, currentPeriod }, isStartup ? 'Submitting startup proof for period' : 'Submitting proof for period');
      if (!isStartup) {
        const maxDelay = Math.max(0, getRemainingTimeInPeriodMs(currentPeriod) - ProofSubmitService.MIN_DELAY_MS);
        logger.info({ period, currentPeriod, maxDelayMs: maxDelay }, 'Waiting random jitter before submit');
        await this.waitWithRandomDelay(maxDelay);
      }

      if (!this.isRunning) return;

      if (await this.isProofAlreadySubmitted(period)) {
        logger.info({ period, currentPeriod }, `Proof for period ${period} already exists, skipping`);
        return;
      }

      const proof = await this.proofProvider.getAggregatedProof(period);
      if (!proof) {
        logger.warn({ period, currentPeriod }, `No proof data available for period ${period}`);
        return;
      }

      // Double-check to prevent race conditions
      if (await this.isProofAlreadySubmitted(period)) {
        logger.info({ period, currentPeriod }, `Proof for period ${period} was submitted by another process`);
        return;
      }

      await this.submitProof(period, proof);
    } catch (err) {
      logger.error(err, `Error submitting proof for period ${period}`);
      await this.sleep(ProofSubmitService.ERROR_RETRY_DELAY_MS);
    }
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

  // Utility Methods
  private async waitWithRandomDelay(maxDelayMs?: number): Promise<void> {
    const randomDelay = ProofSubmitService.MIN_DELAY_MS +
      Math.random() * (ProofSubmitService.MAX_RANDOM_DELAY_MS - ProofSubmitService.MIN_DELAY_MS);

    const delay = maxDelayMs !== undefined
      ? Math.min(randomDelay, Math.max(maxDelayMs, 0))
      : randomDelay;
    logger.debug({ delayMs: Math.round(delay) }, 'Random jitter selected');
    await this.sleep(delay);
  }

  private sleep(ms: number): Promise<void> {
    return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
  }
}
