import { dasApi, DasApiInterface } from "@metaplex-foundation/digital-asset-standard-api";
import { mplBubblegum } from "@metaplex-foundation/mpl-bubblegum";
import { createSignerFromKeypair, RpcInterface, signerIdentity, Umi } from "@metaplex-foundation/umi";
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { appendTransactionMessageInstructions, BaseTransactionMessage, createSolanaRpc, createSolanaRpcSubscriptions, createTransactionMessage, getSignatureFromTransaction, MessageSigner, pipe, Rpc, sendAndConfirmTransactionFactory, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, Signature, signTransactionMessageWithSigners, SolanaError, SolanaRpcApi, TransactionSigner } from "gill";
import { createHelius, HeliusClient } from "helius-sdk";
import { CheckerConfig } from '../config.js';
import { getLogger } from '../logger.js';

const logger = getLogger('RpcClient');

export interface RpcClient {
    helius: HeliusClient;
    umi: Umi & { rpc: DasApiInterface; };
    buildAndSendTransaction: (instructions: ReadonlyArray<BaseTransactionMessage['instructions'][number]>, commitment?: "processed" | "confirmed" | "finalized") => Promise<{ signature: Signature; logs: readonly string[] | null }>;
}

function createUmiClient(config: CheckerConfig): Umi & { rpc: DasApiInterface; } {
    const umi = createUmi(config.getSolanaRpcUrl())
        .use(mplBubblegum())
        .use(dasApi());

    const signer = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(config.checkerPrivateKeyBytes));

    umi.use(signerIdentity(signer));

    return {
        ...umi,
        rpc: umi.rpc as unknown as RpcInterface & DasApiInterface,
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

export function createRpcClient(signer: TransactionSigner & MessageSigner, config: CheckerConfig): RpcClient {
    const helius = createHelius({ apiKey: config.heliusApiKey, network: config.solanaNetwork });

    // Create Gill RPC clients for transaction handling
    const rpc = createSolanaRpc(config.getSolanaRpcUrl());
    const rpcSubscriptions = createSolanaRpcSubscriptions(config.getSolanaRpcUrl().replace('http', 'ws'));

    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    const buildAndSendTransaction = createBuildAndSendTransactionFn({
        rpc,
        wallet: signer,
        sendAndConfirmTransaction
    });

    return { helius, umi: createUmiClient(config), buildAndSendTransaction };
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
