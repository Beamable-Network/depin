import { ActivateChecker } from '@beamable-network/depin';
import { getAssetWithProof } from '@metaplex-foundation/mpl-bubblegum';
import { publicKey } from '@metaplex-foundation/umi';
import {
    address,
    createKeyPairSignerFromPrivateKeyBytes,
    createTransaction,
    getExplorerLink,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners
} from 'gill';
import { askForInput } from 'utils';
import { createClient } from '../client';

// Initialize Solana client
const client = await createClient('mainnet');

// Get checker license address from user
const licenseAddress = await askForInput("Enter checker license");
const licenseProof = await getAssetWithProof(client.umi, publicKey(licenseAddress));

// Activate checker license and set delegate
const activation = new ActivateChecker({
    checker_license: licenseProof,
    delegated_to: address(client.umi.identity.publicKey),
    signer: address(client.umi.identity.publicKey)
});

// Build and sign transaction
const tx = createTransaction({
    instructions: [await activation.getInstruction()],
    feePayer: await createKeyPairSignerFromPrivateKeyBytes(client.umiSigner.secretKey)
});

const { value: latestBlockhash } = await client.rpcClient.rpc.getLatestBlockhash().send();
const signedTransaction = await signTransactionMessageWithSigners(
    setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx)
);

// Send transaction and display result
const signature = await client.rpcClient.sendAndConfirmTransaction(signedTransaction, {
    commitment: "confirmed",
    maxRetries: 5n
});

console.log(getExplorerLink({ transaction: signature, cluster: client.network }));