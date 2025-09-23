import { dasApi, DasApiInterface } from "@metaplex-foundation/digital-asset-standard-api";
import { mplAccountCompression } from '@metaplex-foundation/mpl-account-compression';
import { mplBubblegum } from "@metaplex-foundation/mpl-bubblegum";
import { mplCore } from "@metaplex-foundation/mpl-core";
import { mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import { createSignerFromKeypair, RpcInterface, signerIdentity, Umi } from "@metaplex-foundation/umi";
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import * as dotenv from "dotenv";
import {
  Address,
  appendTransactionMessageInstructions,
  BaseTransactionMessage,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  Lamports,
  MessageSigner,
  pipe,
  Rpc,
  RpcSubscriptions,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  Signature,
  signTransactionMessageWithSigners,
  SolanaRpcApi,
  SolanaRpcSubscriptionsApi,
  TransactionSigner
} from "gill";
import * as path from "path";

// Load environment variables from .env file in tests directory
dotenv.config({ path: path.join(__dirname, "..", ".env") });

export type Client = {
  rpc: Rpc<SolanaRpcApi>;
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>;
  wallet: TransactionSigner & MessageSigner;
  buildAndSendTransaction: (instructions: ReadonlyArray<BaseTransactionMessage['instructions'][number]>, commitment?: "processed" | "confirmed" | "finalized") => Promise<{ signature: Signature; logs: readonly string[] | null }>;
  fetchAccountBalance: (address: Address) => Promise<Lamports>;
  fetchTokenAccountBalance: (address: Address) => Promise<BigInt>;
  rpcUrl: string;
};

let clientInstance: Client | undefined;

/**
 * Creates a Solana client with wallet from environment variables
 * 
 * @param clusterUrl - RPC URL for the Solana cluster (optional, defaults to env var)
 * @param clusterWsUrl - WebSocket URL for the Solana cluster (optional, defaults to env var)
 * @returns Client instance
 */
export async function createClient(
  clusterUrl?: string,
  clusterWsUrl?: string
): Promise<Client> {
  if (clientInstance) {
    return clientInstance;
  }

  // Use environment variables or provided parameters
  const rpcUrl = clusterUrl || process.env.RPC_URL || "https://api.devnet.solana.com";
  const rpcWsUrl = clusterWsUrl || process.env.RPC_WS_URL || "wss://api.devnet.solana.com";

  // Create connection clients
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(rpcWsUrl);

  // Create wallet from environment variable
  const wallet = await createWalletFromEnv();

  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  const buildAndSendTransaction = createBuildAndSendTransactionFn({
    rpc,
    wallet,
    sendAndConfirmTransaction
  });

  clientInstance = {
    rpc,
    rpcSubscriptions,
    wallet,
    buildAndSendTransaction,
    fetchAccountBalance: createFetchAccountBalanceFn(rpc),
    fetchTokenAccountBalance: createFetchTokenAccountBalanceFn(rpc),
    rpcUrl
  };

  return clientInstance;
}

export function createUmiClient(clusterUrl?: string): Umi & { rpc: DasApiInterface; } {
  const rpcUrl = clusterUrl || process.env.RPC_URL || "https://api.devnet.solana.com";

  const walletBytes = getWalletPrivateKeyBytes();

  const umi = createUmi(rpcUrl)
    .use(mplTokenMetadata())
    .use(mplCore())
    .use(mplAccountCompression())
    .use(mplBubblegum())
    .use(dasApi());

  const keypair = umi.eddsa.createKeypairFromSecretKey(walletBytes);
  const signer = createSignerFromKeypair(umi, keypair);

  umi.use(signerIdentity(signer));

  return {
    ...umi,
    rpc: umi.rpc as unknown as RpcInterface & DasApiInterface,
  };
}

async function createWalletFromEnv(): Promise<TransactionSigner & MessageSigner> {
  try {
    const privateKeyBytes = getWalletPrivateKeyBytes();
    return await createKeyPairSignerFromBytes(privateKeyBytes);
  } catch (err) {
    throw new Error("Invalid WALLET_PRIVATE_KEY format. Please ensure it's a valid JSON array of numbers.");
  }
}

export function getWalletPrivateKeyBytes(): Uint8Array {
  const privateKeyJson = process.env.WALLET_PRIVATE_KEY;

  if (!privateKeyJson) {
    throw new Error("WALLET_PRIVATE_KEY environment variable is required. Please set it in the .env file.");
  }

  if (privateKeyJson.includes("1,2,3,4,5")) {
    throw new Error("Please replace the placeholder WALLET_PRIVATE_KEY in the .env file with your actual keypair array.");
  }

  try {
    const privateKeyArray = JSON.parse(privateKeyJson);
    return new Uint8Array(privateKeyArray);
  } catch (err) {
    throw new Error("Invalid WALLET_PRIVATE_KEY format. Please ensure it's a valid JSON array of numbers.");
  }
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

      console.log('Sending transaction with signature:', txSig);
      await sendAndConfirmTransaction(tx, { commitment, skipPreflight: false });


      const txInfo = await rpc.getTransaction(txSig, {
        maxSupportedTransactionVersion: 0,
        commitment,
        encoding: 'json'
      }).send();
      console.log('Transaction logs:', txInfo.meta.logMessages);

      return { signature: txSig, logs: txInfo.meta.logMessages };
    } catch (err) {
      console.error('Error sending transaction:', err);
      throw err;
    }
  };
}

function createFetchAccountBalanceFn(rpc: Rpc<SolanaRpcApi>) {
  return async (address: Address): Promise<Lamports> => {
    const response = await rpc.getBalance(address).send();
    return response.value;
  };
}

function createFetchTokenAccountBalanceFn(rpc: Rpc<SolanaRpcApi>) {
  return async (address: Address): Promise<BigInt> => {
    const balanceResponse = await rpc.getTokenAccountBalance(address).send();
    if (!balanceResponse) {
      throw new Error(`Account not found: ${address}`);
    }
    return BigInt(balanceResponse.value.amount);
  };
}