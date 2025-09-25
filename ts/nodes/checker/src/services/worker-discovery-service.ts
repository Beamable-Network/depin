import { DEPIN_PROGRAM, DepinAccountType, ProgramAccount, WorkerDiscoveryDocument, WorkerMetadataAccount } from '@beamable-network/depin';
import { address, getBase58Codec, getBase64Codec, getU8Codec, isNone } from 'gill';
import { GetProgramAccountsV2Config } from 'helius-sdk/types/types';
import pLimit from 'p-limit';
import { Agent, request } from 'undici';
import { CheckerNode } from '../checker.js';
import { getLogger } from '../logger.js';

const logger = getLogger('WorkerDiscoveryService');

export interface ResolvedWorkerDiscovery {
  workerAccount: ProgramAccount<WorkerMetadataAccount>;
  discovery: WorkerDiscoveryDocument;
}

export class WorkerDiscoveryService {
  private static readonly HTTP_TIMEOUT_MS = 10_000; // 10s per request
  private static readonly RETRY_INTERVAL_MS = 30 * 60_000; // 30 min between retries
  private static readonly CONCURRENCY = 10;

  private agent: Agent;

  constructor(private readonly checker: CheckerNode) {
    this.agent = new Agent({
      keepAliveMaxTimeout: 30_000,
      headersTimeout: WorkerDiscoveryService.HTTP_TIMEOUT_MS,
      bodyTimeout: WorkerDiscoveryService.HTTP_TIMEOUT_MS,
      keepAliveTimeout: 10_000,
      connections: 64,
    });
  }

  async fetchActiveWorkerAccounts(): Promise<Array<ProgramAccount<WorkerMetadataAccount>>> {
    const helius = this.checker.getRpcClient().helius;

    const activeWorkerAccounts: Array<ProgramAccount<WorkerMetadataAccount>> = [];
    let paginationKey: string | null = null;

    do {
      const requestOptions: GetProgramAccountsV2Config = {
        encoding: 'base64',
        limit: 1000,
        filters: [
          {
            memcmp: {
              bytes: getBase58Codec().decode(getU8Codec().encode(DepinAccountType.WorkerMetadata)),
              offset: 0,
            },
          },
        ],
      };

      if (paginationKey) {
        requestOptions.paginationKey = paginationKey;
      }

      const res = await helius.getProgramAccountsV2([DEPIN_PROGRAM, requestOptions]);

      for (const account of res.accounts) {
        const dataField = account.account.data;
        if (dataField == null) continue;
        try {
          const workerAccount = WorkerMetadataAccount.deserializeFrom(getBase64Codec().encode(account.account.data));
          if (isNone(workerAccount.suspendedAt) && workerAccount.discoveryUri.trim().length > 0) {
            activeWorkerAccounts.push({
              address: address(account.pubkey),
              data: workerAccount
            });
          }
        } catch {
          // Ignore invalid accounts
        }
      }

      paginationKey = res.paginationKey || null;
    } while (paginationKey);

    return activeWorkerAccounts;
  }

  async resolve(params: {
    workerAccounts: ProgramAccount<WorkerMetadataAccount>[];
    period: number;
    onResolved: (entry: ResolvedWorkerDiscovery) => void;
  }): Promise<void> {
    const { workerAccounts, period, onResolved } = params;

    const limit = pLimit(WorkerDiscoveryService.CONCURRENCY);

    await Promise.all(
      workerAccounts.map(workerAccount =>
        limit(async () => {
          const uri = (workerAccount.data.discoveryUri ?? '').trim();
          const doc = await this.tryFetchDiscoveryUri(uri, period);
          
          if (doc) {
            const expectedPda = await WorkerMetadataAccount.findWorkerMetadataPDA(address(doc.worker.license), address(doc.worker.address));
            if (expectedPda[0] != workerAccount.address) {
              logger.warn({ expectedPda: expectedPda[0], actualPda: workerAccount.address }, 'Worker PDA does not match discovery document');
              // TODO: schedule a retry after 30 minutes
            }
            else {
              onResolved({ workerAccount, discovery: doc });
            }
          }
          else {
            // TODO: schedule a retry after 30 minutes
          }
        })
      )
    );
  }

  private async tryFetchDiscoveryUri(uri: string, period: number): Promise<WorkerDiscoveryDocument | null> {
    if (!uri?.length) return null;
    try {
      const res = await request(uri, {
        method: 'GET',
        dispatcher: this.agent,
        headersTimeout: WorkerDiscoveryService.HTTP_TIMEOUT_MS,
        bodyTimeout: WorkerDiscoveryService.HTTP_TIMEOUT_MS,
      });

      if (res.statusCode !== 200) {
        logger.warn({ status: res.statusCode, uri, period }, 'Discovery fetch failed');
        return null;
      }

      const json = await res.body.json();
      const discovery = json as WorkerDiscoveryDocument;
      return discovery;
    } catch (err) {
      logger.warn({ err, uri, period }, 'Discovery request error');
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
  }
}
