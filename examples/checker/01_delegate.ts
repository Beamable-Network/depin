import { ActivateChecker } from '@beamable-network/depin';
import { getAssetWithProof } from '@metaplex-foundation/mpl-bubblegum';
import { publicKey } from '@metaplex-foundation/umi';
import {
    address,
    createTransaction,
    getExplorerLink,
    isAddress,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners
} from 'gill';
import { askForInput } from 'utils';
import { createClient } from '../client';

// Initialize Solana client
const client = await createClient('devnet');

// Get checker license address from user
const licenseAddress = await askForInput("Enter checker license");
if (!isAddress(licenseAddress)) {
    throw new Error("Invalid license address");
}

// Get checker delegate address from user
const delegateAddress = await askForInput("Enter delegate address");
if (!isAddress(delegateAddress)) {
    throw new Error("Invalid delegate address");
}

const licenseProof = await getAssetWithProof(client.umi, publicKey(licenseAddress), { truncateCanopy: true });

// Activate checker license and set delegate
const activation = new ActivateChecker({
    checker_license: licenseProof,
    delegated_to: address(delegateAddress),
    signer: address(client.umi.identity.publicKey)
});

// Build and sign transaction
const tx = createTransaction({
    instructions: [await activation.getInstruction()],
    feePayer: client.signer
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