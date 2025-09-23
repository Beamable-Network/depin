import { getCurrentPeriod } from '@beamable-network/depin';
import { getLogger } from '../logger.js';
import { CheckerNode } from '../checker.js';

const logger = getLogger('CheckerService');

export class CheckerService {
  private isRunning = false;

  constructor(private readonly checker: CheckerNode) {}

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('CheckerService is already running');
      return;
    }
    this.isRunning = true;
    logger.info({ currentPeriod: getCurrentPeriod() }, 'Starting CheckerService');

    await this.runLoop();
  }
  async runLoop() {
    while(this.isRunning) {
      await this.sleep(3000);
      logger.info('CheckerService heartbeat');
    }
  }

  stop(): void {
    logger.info('Stopping CheckerService');
    this.isRunning = false;
  }

  private sleep(ms: number): Promise<void> {
    return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
  }
}
