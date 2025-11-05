import { dasApi, DasApiInterface } from "@metaplex-foundation/digital-asset-standard-api";
import { mplBubblegum } from '@metaplex-foundation/mpl-bubblegum';
import { createSignerFromKeypair, RpcInterface, signerIdentity, Umi } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { appendTransactionMessageInstructions, BaseTransactionMessage, createSolanaRpc, createSolanaRpcSubscriptions, createTransactionMessage, FullySignedTransaction, getSignatureFromTransaction, MessageSigner, pipe, Rpc, sendAndConfirmTransactionFactory, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, Signature, signTransactionMessageWithSigners, simulateTransactionFactory, SolanaError, SolanaRpcApi, TransactionSigner } from "gill";
import { createHelius } from "helius-sdk";
import type { GetAssetResponseList, SearchAssetsRequest } from 'helius-sdk/types/das';
import pThrottle from 'p-throttle';
import { WorkerConfig } from '../config.js';
import { getLogger } from '../logger.js';

const logger = getLogger('RpcClient');

export interface RpcClient {
    umi: Umi & { rpc: DasApiInterface; };
    buildAndSendTransaction: (instructions: ReadonlyArray<BaseTransactionMessage['instructions'][number]>, commitment?: "processed" | "confirmed" | "finalized") => Promise<{ signature: Signature; logs: readonly string[] | null }>;
    simulateTransaction: (transaction: FullySignedTransaction) => Promise<{ logs: readonly string[] | null; err: any }>;
    searchAssets: (params: SearchAssetsRequest) => Promise<GetAssetResponseList>;
}

function createUmiClient(config: WorkerConfig): Umi & { rpc: DasApiInterface; } {
    const umi = createUmi(config.getSolanaRpcUrl())
        .use(mplBubblegum())
        .use(dasApi());

    const signer = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(new Uint8Array(config.workerPrivateKeyBytes)));

    umi.use(signerIdentity(signer));

    return {
        ...umi,
        rpc: umi.rpc as unknown as RpcInterface & DasApiInterface,
    };
}

function createSimulateTransactionFn(params: {
    simulateTransaction: ReturnType<typeof simulateTransactionFactory>;
}) {
    const { simulateTransaction } = params;
    return async (transaction: FullySignedTransaction): Promise<{ logs: readonly string[] | null; err: any }> => {
        try {
            const simulationResult = await simulateTransaction(transaction, { commitment: 'confirmed' });

            const logs = simulationResult.value.logs || [];
            const err = simulationResult.value.err;

            return { logs, err };
        } catch (err) {
            logger.error({ err: getErrorMessage(err) }, 'Error simulating transaction');
            throw err;
        }
    };
}

function createBuildAndSendTransactionFn(params: {
    rpc: Rpc<SolanaRpcApi>;
    wallet: TransactionSigner & MessageSigner;
    sendAndConfirmTransaction: ReturnType<typeof sendAndConfirmTransactionFactory>;
}) {
    const { rpc, wallet, sendAndConfirmTransaction } = params;
    return async (instructions: ReadonlyArray<BaseTransactionMessage['instructions'][number]>, commitment: "processed" | "confirmed" | "finalized" = "confirmed"): Promise<{ signature: Signature; logs: readonly string[] | null }> => {
        const recent = await rpc.getLatestBlockhash().send();
        try {

            const txMessage = await pipe(
                createTransactionMessage({ version: 0 }),
                (tx) => setTransactionMessageFeePayerSigner(wallet, tx),
                (tx) => setTransactionMessageLifetimeUsingBlockhash(recent.value, tx),
                (tx) => appendTransactionMessageInstructions(instructions, tx)
            );

            const tx = await signTransactionMessageWithSigners(txMessage);
            const txSig = getSignatureFromTransaction(tx);

            logger.debug({ txSig }, 'Sending transaction with signature');
            await sendAndConfirmTransaction(tx, { commitment, skipPreflight: false });


            const txInfo = await rpc.getTransaction(txSig, {
                maxSupportedTransactionVersion: 0,
                commitment,
                encoding: 'json'
            }).send();

            const logs = txInfo?.meta?.logMessages || [];
            logger.debug({ logs }, 'Transaction logs');

            return { signature: txSig, logs };
        } catch (err) {
            logger.error({ err: getErrorMessage(err) }, 'Error sending transaction');
            throw err;
        }
    };
}

export function createRpcClient(signer: TransactionSigner & MessageSigner, config: WorkerConfig): RpcClient {
    const helius = createHelius({ apiKey: config.heliusApiKey, network: config.solanaNetwork });
    const umiClient = createUmiClient(config);

    // Create Gill RPC clients for transaction handling
    const rpc = createSolanaRpc(config.getSolanaRpcUrl());
    const rpcSubscriptions = createSolanaRpcSubscriptions(config.getSolanaRpcUrl().replace('http', 'ws'));

    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    // Throttle sendAndConfirmTransaction using config
    const sendAndConfirmTransactionThrottled = pThrottle({
        limit: config.throttle.sendTransaction.limit,
        interval: config.throttle.sendTransaction.interval
    })(sendAndConfirmTransaction);

    const buildAndSendTransaction = createBuildAndSendTransactionFn({
        rpc,
        wallet: signer,
        sendAndConfirmTransaction: sendAndConfirmTransactionThrottled
    });

    const simulateTransaction = createSimulateTransactionFn({
        simulateTransaction: simulateTransactionFactory({ rpc })
    });

    // Throttle searchAssets using config
    const searchAssetsThrottled = pThrottle({
        limit: config.throttle.searchAssets.limit,
        interval: config.throttle.searchAssets.interval
    })(async (params: SearchAssetsRequest) => {
        return await helius.searchAssets(params);
    });

    const searchAssets = async (params: SearchAssetsRequest): Promise<GetAssetResponseList> => {
        const allAssets: GetAssetResponseList['items'] = [];
        let cursor: string | undefined = params.cursor;
        const limit = params.limit ?? 1000;

        while (true) {
            const result = await searchAssetsThrottled({
                ...params,
                limit,
                cursor
            });

            allAssets.push(...result.items);

            // Check if there are more pages
            if (!result.cursor) {
                return {
                    total: result.total,
                    limit: result.limit,
                    items: allAssets,
                    cursor: result.cursor
                };
            }

            cursor = result.cursor;
        }
    };

    return {
        umi: umiClient,
        buildAndSendTransaction,
        simulateTransaction,
        searchAssets
    };
}

function getErrorMessage(error: unknown): string {
    if (error instanceof SolanaError) {
        // Traverse the error chain to find the root cause
        let currentError: any = error;
        const messages: string[] = [];

        while (currentError) {
            if (currentError.message) {
                messages.push(currentError.message);
            }

            // Move to the next error in the chain
            if (currentError.cause instanceof Error) {
                currentError = currentError.cause;
            } else if (currentError.cause && typeof currentError.cause === 'object' && 'message' in currentError.cause) {
                currentError = currentError.cause;
            } else {
                break;
            }
        }

        // Return all messages joined, or just the original message if no chain found
        return messages.length > 1 ? messages.join(' -> ') : (error.message || 'Unknown SolanaError');
    }

    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}
