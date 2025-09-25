import { DEPIN_PROGRAM, DepinAccountType, ProgramAccount, sleep, WorkerDiscoveryDocument, WorkerMetadataAccount } from '@beamable-network/depin';
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
    const network = this.checker.getNetwork();
    
    if (network === 'devnet') {
      return this.fetchActiveWorkerAccountsV1();
    } else {
      return this.fetchActiveWorkerAccountsV2();
    }
  }

  private async fetchActiveWorkerAccountsV2(): Promise<Array<ProgramAccount<WorkerMetadataAccount>>> {    
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

  private async fetchActiveWorkerAccountsV1(): Promise<Array<ProgramAccount<WorkerMetadataAccount>>> {
    const helius = this.checker.getRpcClient().helius;
    
    const activeWorkerAccounts: Array<ProgramAccount<WorkerMetadataAccount>> = [];

    const requestOptions = {
      encoding: 'base64' as const,
      filters: [
        {
          memcmp: {
            bytes: getBase58Codec().decode(getU8Codec().encode(DepinAccountType.WorkerMetadata)),
            offset: 0,
          },
        },
      ],
    };

    const res = await helius.getProgramAccounts(DEPIN_PROGRAM, requestOptions);

    for (const account of res) {
      const dataField = account.account.data;
      if (dataField == null) continue;
      try {
        const workerAccount = WorkerMetadataAccount.deserializeFrom(getBase64Codec().encode(account.account.data[0]));
        if (isNone(workerAccount.suspendedAt) && workerAccount.discoveryUri.trim().length > 0) {
          activeWorkerAccounts.push({
            address: address(account.pubkey),
            data: workerAccount
          });
        }
      } catch(err) {
        const x = err;
        // Ignore invalid accounts
      }
    }

    return activeWorkerAccounts;
  }

  async resolve(params: {
    workerAccounts: ProgramAccount<WorkerMetadataAccount>[];
    period: number;
    onResolved: (entry: ResolvedWorkerDiscovery) => void;
    signal?: AbortSignal;
  }): Promise<void> {
    const { workerAccounts, period, onResolved, signal } = params;

    const limit = pLimit(WorkerDiscoveryService.CONCURRENCY);

    // Track which workers still need a successful resolution
    const pending = new Set(workerAccounts);

    while (pending.size > 0) {
      signal?.throwIfAborted();
      const batch = Array.from(pending);

      await Promise.all(
        batch.map(workerAccount =>
          limit(async () => {
            signal?.throwIfAborted();
            const uri = (workerAccount.data.discoveryUri ?? '').trim();
            const doc = await this.tryFetchDiscoveryUri(uri, period, signal);

            if (doc) {
              try {
                onResolved({ workerAccount, discovery: doc });
              } finally {
                pending.delete(workerAccount);
              }
            }
          })
        )
      );

      if (pending.size > 0) {
        logger.info({ remaining: pending.size, period }, 'Discovery unresolved; retrying later');
        await sleep(WorkerDiscoveryService.RETRY_INTERVAL_MS, signal);
      }
    }
  }

  private async tryFetchDiscoveryUri(uri: string, period: number, signal?: AbortSignal): Promise<WorkerDiscoveryDocument | null> {
    if (!uri?.length) return null;
    try {
      const res = await request(uri, {
        method: 'GET',
        dispatcher: this.agent,
        headersTimeout: WorkerDiscoveryService.HTTP_TIMEOUT_MS,
        bodyTimeout: WorkerDiscoveryService.HTTP_TIMEOUT_MS,
        signal
      });

      if (res.statusCode !== 200) {
        logger.warn({ status: res.statusCode, uri, period }, 'Discovery fetch failed');
        return null;
      }

      const json = await res.body.json();
      const discovery = json as WorkerDiscoveryDocument;
      return discovery;
    } catch (err) {
      // Propagate cancellation (when signaled or when undici throws AbortError)
      if (signal?.aborted || (err as Error)?.name === 'AbortError') {
        throw err;
      }
      logger.warn({ err, uri, period }, 'Discovery request error');
      return null;
    }
  }
}
