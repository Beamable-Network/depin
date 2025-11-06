import { dasApi, DasApiInterface } from "@metaplex-foundation/digital-asset-standard-api";
import { mplBubblegum } from '@metaplex-foundation/mpl-bubblegum';
import { createSignerFromKeypair, RpcInterface, signerIdentity, Umi } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { trace } from "@opentelemetry/api";
import { Address, appendTransactionMessageInstructions, BaseTransactionMessage, createSolanaRpc, createSolanaRpcSubscriptions, createTransactionMessage, FullySignedTransaction, getSignatureFromTransaction, MessageSigner, pipe, Rpc, sendAndConfirmTransactionFactory, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, Signature, signTransactionMessageWithSigners, simulateTransactionFactory, SolanaError, SolanaRpcApi, TransactionSigner } from "gill";
import { createHelius } from "helius-sdk";
import type { GetAssetResponseList, SearchAssetsRequest } from 'helius-sdk/types/das';
import pThrottle from 'p-throttle';
import { WorkerConfig } from '../config.js';
import { getLogger } from '../logger.js';
import { withRetry } from './retry.js';

const logger = getLogger('RpcClient');

function getTracer() {
    return trace.getTracer('rpc-client');
}

export interface RpcClient {
    umi: Umi & { rpc: DasApiInterface; };
    buildAndSendTransaction: (instructions: ReadonlyArray<BaseTransactionMessage['instructions'][number]>, commitment?: "processed" | "confirmed" | "finalized") => Promise<{ signature: Signature; logs: readonly string[] | null }>;
    simulateTransaction: (transaction: FullySignedTransaction) => Promise<{ logs: readonly string[] | null; err: any }>;
    searchAssets: (params: SearchAssetsRequest & { tree?: Address }) => Promise<GetAssetResponseList>;
}

// =============================================================================
// Error Handling Utilities
// =============================================================================

class RpcClientError extends Error {
    constructor(
        message: string,
        public readonly originalError: unknown,
        public readonly context?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'RpcClientError';
    }
}

function getErrorMessage(error: unknown): string {
    if (error instanceof SolanaError) {
        const messages: string[] = [];
        let currentError: any = error;

        while (currentError) {
            if (currentError.message) {
                messages.push(currentError.message);
            }

            if (currentError.cause instanceof Error) {
                currentError = currentError.cause;
            } else if (currentError.cause && typeof currentError.cause === 'object' && 'message' in currentError.cause) {
                currentError = currentError.cause;
            } else {
                break;
            }
        }

        return messages.length > 1 ? messages.join(' -> ') : (error.message || 'Unknown SolanaError');
    }

    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function wrapError(error: unknown, context: Record<string, unknown> = {}): RpcClientError {
    return new RpcClientError(getErrorMessage(error), error, context);
}

function isRateLimitError(error: unknown, operation?: string): boolean {
    if (!error) return false;

    let isRateLimit = false;

    // Check for HTTP 429 status
    if (typeof error === 'object' && error !== null) {
        const err = error as any;

        // Check status property
        if (err.status === 429 || err.statusCode === 429) {
            isRateLimit = true;
        }

        // Check response object
        if (err.response?.status === 429) {
            isRateLimit = true;
        }

        // Check error message for rate limit indicators
        if (!isRateLimit) {
            const message = getErrorMessage(error).toLowerCase();
            if (message.includes('429') ||
                message.includes('rate limit') ||
                message.includes('too many requests')) {
                isRateLimit = true;
            }
        }
    }

    if (isRateLimit) {
        const operationContext = operation ? ` [${operation}]` : '';
        logger.warn(
            { err: getErrorMessage(error), operation },
            `Rate limit detected (HTTP 429)${operationContext}, will retry with exponential backoff`
        );
    }

    return isRateLimit;
}

// =============================================================================
// Throttling Service
// =============================================================================

interface ThrottleConfig {
    limit: number;
    interval: number;
}

class ThrottleService {
    static createThrottledFunction<T extends any[], R>(
        fn: (...args: T) => Promise<R>,
        config: ThrottleConfig
    ): (...args: T) => Promise<R> {
        return pThrottle({
            limit: config.limit,
            interval: config.interval
        })(fn);
    }
}

// =============================================================================
// Transaction Service
// =============================================================================

interface TransactionServiceDependencies {
    rpc: Rpc<SolanaRpcApi>;
    rpcUrl: string;
    wallet: TransactionSigner & MessageSigner;
    throttleConfig: ThrottleConfig;
}

class TransactionService {
    private readonly sendAndConfirmTransaction: ReturnType<typeof sendAndConfirmTransactionFactory>;

    constructor(private readonly deps: TransactionServiceDependencies) {
        const { rpc, rpcUrl, throttleConfig } = deps;
        const rpcSubscriptions = createSolanaRpcSubscriptions(
            rpcUrl.replace('http', 'ws')
        );

        const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
        this.sendAndConfirmTransaction = ThrottleService.createThrottledFunction(
            sendAndConfirmTransaction,
            throttleConfig
        );
    }

    async buildAndSendTransaction(
        instructions: ReadonlyArray<BaseTransactionMessage['instructions'][number]>,
        commitment: "processed" | "confirmed" | "finalized" = "confirmed"
    ): Promise<{ signature: Signature; logs: readonly string[] | null }> {
        const { rpc, wallet } = this.deps;

        return await getTracer().startActiveSpan('buildAndSendTransaction', async (span) => {
            try {
                const recent = await rpc.getLatestBlockhash().send();

                const txMessage = pipe(
                    createTransactionMessage({ version: 0 }),
                    (tx) => setTransactionMessageFeePayerSigner(wallet, tx),
                    (tx) => setTransactionMessageLifetimeUsingBlockhash(recent.value, tx),
                    (tx) => appendTransactionMessageInstructions(instructions, tx)
                );

                const signedTx = await signTransactionMessageWithSigners(txMessage);
                const signature = getSignatureFromTransaction(signedTx);

                span.setAttribute('transaction.signature', signature);
                span.setAttribute('transaction.commitment', commitment);
                span.setAttribute('transaction.instructionsCount', instructions.length);

                logger.debug({ txSig: signature }, 'Sending transaction with signature');

                await withRetry(
                    async () => this.sendAndConfirmTransaction(signedTx, { commitment, skipPreflight: false }),
                    {
                        maxRetries: 5,
                        baseDelayMs: 500,
                        exponentialBackoff: true,
                        shouldRetry: (error) => isRateLimitError(error, 'sendAndConfirmTransaction')
                    }
                );

                const transactionInfo = await rpc.getTransaction(signature, {
                    maxSupportedTransactionVersion: 0,
                    commitment,
                    encoding: 'json'
                }).send();

                const logs = transactionInfo?.meta?.logMessages || [];
                logger.debug({ logs }, 'Transaction logs');

                return { signature, logs };
            } catch (error) {
                logger.error({ err: getErrorMessage(error) }, 'Error sending transaction');
                throw wrapError(error, { instructionsCount: instructions.length, commitment });
            } finally {
                span.end();
            }
        });
    }

    async simulateTransaction(transaction: FullySignedTransaction): Promise<{ logs: readonly string[] | null; err: any }> {
        const { rpc } = this.deps;
        const simulateTransaction = simulateTransactionFactory({ rpc });

        try {
            const simulationResult = await simulateTransaction(transaction, { commitment: 'confirmed' });
            return {
                logs: simulationResult.value.logs || [],
                err: simulationResult.value.err
            };
        } catch (error) {
            logger.error({ err: getErrorMessage(error) }, 'Error simulating transaction');
            throw wrapError(error, { transactionSignature: getSignatureFromTransaction(transaction) });
        }
    }
}

// =============================================================================
// Asset Service
// =============================================================================

interface AssetServiceDependencies {
    heliusApiKey: string;
    solanaNetwork: "mainnet" | "devnet";
    throttleConfig: ThrottleConfig;
}

class AssetService {
    private readonly helius: ReturnType<typeof createHelius>;
    private readonly searchAssetsThrottled: (params: SearchAssetsRequest & { tree?: Address }) => Promise<GetAssetResponseList>;

    constructor(private readonly deps: AssetServiceDependencies) {
        this.helius = createHelius({
            apiKey: deps.heliusApiKey,
            network: deps.solanaNetwork
        });

        this.searchAssetsThrottled = ThrottleService.createThrottledFunction(
            (params: SearchAssetsRequest & { tree?: Address }) => this.helius.searchAssets(params),
            deps.throttleConfig
        );
    }

    async searchAssets(params: SearchAssetsRequest & { tree?: Address }): Promise<GetAssetResponseList> {
        const allAssets: GetAssetResponseList['items'] = [];
        let cursor: string | undefined = params.cursor;
        const limit = params.limit ?? 1000;

        return await getTracer().startActiveSpan('searchAssets', async (span) => {
            try {
                while (true) {
                    const result = await withRetry(
                        async () => this.searchAssetsThrottled({
                            ...params,
                            limit,
                            cursor
                        }),
                        {
                            maxRetries: 5,
                            baseDelayMs: 500,
                            exponentialBackoff: true,
                            shouldRetry: (error) => isRateLimitError(error, 'searchAssets')
                        }
                    );

                    allAssets.push(...result.items);

                    if (!result.cursor) {
                        span.setAttribute('assets.totalCount', allAssets.length);
                        span.setAttribute('assets.totalReported', result.total);

                        return {
                            total: result.total,
                            limit: result.limit,
                            items: allAssets,
                            cursor: result.cursor
                        };
                    }

                    cursor = result.cursor;
                }
            } finally {
                span.end();
            }
        });
    }
}

// =============================================================================
// UMI Client Factory
// =============================================================================

function createUmiClient(config: WorkerConfig): Umi & { rpc: DasApiInterface; } {
    const umi = createUmi(config.getSolanaRpcUrl())
        .use(mplBubblegum())
        .use(dasApi());

    const signer = createSignerFromKeypair(
        umi,
        umi.eddsa.createKeypairFromSecretKey(new Uint8Array(config.workerPrivateKeyBytes))
    );

    umi.use(signerIdentity(signer));

    return {
        ...umi,
        rpc: umi.rpc as unknown as RpcInterface & DasApiInterface,
    };
}

// =============================================================================
// Main RPC Client Factory
// =============================================================================

export function createRpcClient(signer: TransactionSigner & MessageSigner, config: WorkerConfig): RpcClient {
    const umiClient = createUmiClient(config);
    const rpcUrl = config.getSolanaRpcUrl();
    const rpc = createSolanaRpc(rpcUrl);

    // Initialize services
    const transactionService = new TransactionService({
        rpc,
        rpcUrl,
        wallet: signer,
        throttleConfig: config.throttle.sendTransaction
    });

    const assetService = new AssetService({
        heliusApiKey: config.heliusApiKey,
        solanaNetwork: config.solanaNetwork,
        throttleConfig: config.throttle.searchAssets
    });

    return {
        umi: umiClient,
        buildAndSendTransaction: (instructions, commitment) =>
            transactionService.buildAndSendTransaction(instructions, commitment),
        simulateTransaction: (transaction) =>
            transactionService.simulateTransaction(transaction),
        searchAssets: (params) =>
            assetService.searchAssets(params)
    };
}

// Export error class for external use
export { RpcClientError };
