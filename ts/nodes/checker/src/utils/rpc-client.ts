import { dasApi, DasApiInterface } from "@metaplex-foundation/digital-asset-standard-api";
import { getAssetWithProof, mplBubblegum } from "@metaplex-foundation/mpl-bubblegum";
import { createSignerFromKeypair, publicKey, RpcInterface, signerIdentity, Umi } from "@metaplex-foundation/umi";
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { trace } from "@opentelemetry/api";
import { appendTransactionMessageInstructions, BaseTransactionMessage, createSolanaRpc, createSolanaRpcSubscriptions, createTransactionMessage, GetProgramAccountsMemcmpFilter, getSignatureFromTransaction, KeyPairSigner, MessageSigner, pipe, Rpc, sendAndConfirmTransactionFactory, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, Signature, signTransactionMessageWithSigners, SolanaError, SolanaRpcApi, TransactionSigner } from "gill";
import { createHelius } from "helius-sdk";
import { GetProgramAccountsV2Config } from 'helius-sdk/types/types';
import pThrottle from 'p-throttle';
import { CheckerConfig } from '../config.js';
import { getLogger } from '../logger.js';
import { withRetry } from './retry.js';

const logger = getLogger('RpcClient');

function getTracer() {
    return trace.getTracer('rpc-client');
}

export interface RpcClient {
    umi: Umi & { rpc: DasApiInterface; };
    buildAndSendTransaction: (instructions: ReadonlyArray<BaseTransactionMessage['instructions'][number]>, commitment?: "processed" | "confirmed" | "finalized") => Promise<{ signature: Signature; logs: readonly string[] | null }>;
    getProgramAccounts: (programAddress: string, filters: GetProgramAccountsMemcmpFilter[]) => Promise<Array<{ pubkey: string; account: { data: ArrayLike<number> } }>>;
    getLicenseWithProof: (assetId: string) => Promise<Awaited<ReturnType<typeof getAssetWithProof>>>;
    getAccount: (address: string) => Promise<Uint8Array | null>;
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
                        shouldRetry: (error) => isRateLimitError(error, 'sendAndConfirmTransaction'),
                        operationName: 'Send and confirm transaction',
                        logContext: {
                            txSignature: signature
                        }
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
}

// =============================================================================
// Program Accounts Service
// =============================================================================

interface ProgramAccountsServiceDependencies {
    helius: ReturnType<typeof createHelius>;
    throttleConfig: ThrottleConfig;
}

class ProgramAccountsService {
    private readonly getProgramAccountsV2Throttled: (
        programAddress: string,
        requestOptions: GetProgramAccountsV2Config
    ) => Promise<Awaited<ReturnType<ReturnType<typeof createHelius>['getProgramAccountsV2']>>>;

    constructor(private readonly deps: ProgramAccountsServiceDependencies) {
        this.getProgramAccountsV2Throttled = ThrottleService.createThrottledFunction(
            (programAddress: string, requestOptions: GetProgramAccountsV2Config) =>
                deps.helius.getProgramAccountsV2([programAddress, requestOptions]),
            deps.throttleConfig
        );
    }

    async getProgramAccounts(
        programAddress: string,
        filters: GetProgramAccountsMemcmpFilter[]
    ): Promise<Array<{ pubkey: string; account: { data: ArrayLike<number> } }>> {
        const allAccounts: Array<{ pubkey: string; account: { data: ArrayLike<number> } }> = [];
        let paginationKey: string | null = null;

        return await getTracer().startActiveSpan('getProgramAccounts', async (span) => {
            try {
                do {
                    const requestOptions: GetProgramAccountsV2Config = {
                        encoding: 'base64',
                        limit: 1000,
                        filters: filters.map(f => ({
                            memcmp: {
                                offset: Number(f.memcmp.offset),
                                bytes: f.memcmp.bytes,
                                encoding: f.memcmp.encoding
                            }
                        })),
                    };

                    if (paginationKey) {
                        requestOptions.paginationKey = paginationKey;
                    }

                    const result = await withRetry(
                        async () => this.getProgramAccountsV2Throttled(programAddress, requestOptions),
                        {
                            maxRetries: 5,
                            baseDelayMs: 500,
                            exponentialBackoff: true,
                            shouldRetry: (error) => isRateLimitError(error, 'getProgramAccountsV2'),
                            operationName: 'Get program accounts V2',
                            logContext: {
                                programAddress
                            }
                        }
                    );

                    // Convert base64 data to Buffer (ArrayLike<number>)
                    for (const acc of result.accounts) {
                        allAccounts.push({
                            pubkey: acc.pubkey,
                            account: {
                                data: Buffer.from(acc.account.data[0], 'base64')
                            }
                        });
                    }

                    paginationKey = result.paginationKey || null;
                } while (paginationKey);

                return allAccounts;
            }
            finally {
                span.end();
            }
        });
    }
}

// =============================================================================
// Asset Service
// =============================================================================

interface AssetServiceDependencies {
    umi: Umi & { rpc: DasApiInterface; };
    getLicenseWithProofThrottleConfig: ThrottleConfig;
    getAccountThrottleConfig: ThrottleConfig;
}

class AssetService {
    private readonly getLicenseWithProofThrottled: (assetId: string) => Promise<Awaited<ReturnType<typeof getAssetWithProof>>>;
    private readonly getAccountThrottled: (address: string) => Promise<Uint8Array | null>;

    constructor(private readonly deps: AssetServiceDependencies) {
        this.getLicenseWithProofThrottled = ThrottleService.createThrottledFunction(
            (assetId: string) => getAssetWithProof(deps.umi, publicKey(assetId), { truncateCanopy: true }),
            deps.getLicenseWithProofThrottleConfig
        );

        this.getAccountThrottled = ThrottleService.createThrottledFunction(
            async (address: string) => {
                const accountData = await deps.umi.rpc.getAccount(publicKey(address));
                return accountData.exists ? accountData.data : null;
            },
            deps.getAccountThrottleConfig
        );
    }

    async getLicenseWithProof(assetId: string): Promise<Awaited<ReturnType<typeof getAssetWithProof>>> {
        return withRetry(
            async () => this.getLicenseWithProofThrottled(assetId),
            {
                maxRetries: 5,
                baseDelayMs: 500,
                exponentialBackoff: true,
                shouldRetry: (error) => isRateLimitError(error, 'getAssetWithProof'),
                operationName: 'Get asset with proof',
                logContext: {
                    assetId
                }
            }
        );
    }

    async getAccount(address: string): Promise<Uint8Array | null> {
        return withRetry(
            async () => this.getAccountThrottled(address),
            {
                maxRetries: 5,
                baseDelayMs: 500,
                exponentialBackoff: true,
                shouldRetry: (error) => isRateLimitError(error, 'getAccount'),
                operationName: 'Get account',
                logContext: {
                    accountAddress: address
                }
            }
        );
    }
}

// =============================================================================
// UMI Client Factory
// =============================================================================

function createUmiClient(config: CheckerConfig): Umi & { rpc: DasApiInterface; } {
    const umi = createUmi(config.getSolanaRpcUrl())
        .use(mplBubblegum())
        .use(dasApi());

    const signer = createSignerFromKeypair(
        umi,
        umi.eddsa.createKeypairFromSecretKey(new Uint8Array(config.checkerPrivateKeyBytes))
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

export function createRpcClient(signer: KeyPairSigner, config: CheckerConfig): RpcClient {
    const umiClient = createUmiClient(config);
    const rpcUrl = config.getSolanaRpcUrl();
    const rpc = createSolanaRpc(rpcUrl);
    const helius = createHelius({
        apiKey: config.heliusApiKey,
        network: config.solanaNetwork as "mainnet" | "devnet"
    });

    // Initialize services
    const transactionService = new TransactionService({
        rpc,
        rpcUrl,
        wallet: signer,
        throttleConfig: config.throttle.sendTransaction
    });

    const programAccountsService = new ProgramAccountsService({
        helius,
        throttleConfig: config.throttle.getProgramAccounts
    });

    const assetService = new AssetService({
        umi: umiClient,
        getLicenseWithProofThrottleConfig: config.throttle.getAssetWithProof,
        getAccountThrottleConfig: config.throttle.getAccount
    });

    return {
        umi: umiClient,
        buildAndSendTransaction: (instructions, commitment) =>
            transactionService.buildAndSendTransaction(instructions, commitment),
        getProgramAccounts: (programAddress, filters) =>
            programAccountsService.getProgramAccounts(programAddress, filters),
        getLicenseWithProof: (assetId) =>
            assetService.getLicenseWithProof(assetId),
        getAccount: (address) =>
            assetService.getAccount(address)
    };
}

// Export error class for external use
export { RpcClientError };
