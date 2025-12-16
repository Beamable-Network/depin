import { MintChecker } from "@beamable-network/depin";
import {
    createTransaction,
    getExplorerLink,
    isAddress,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners
} from "gill";
import { createClient } from "../client";
import { askForInput, askForSecretKey } from "../utils";

// Initialize Solana client
const client = await createClient('devnet');

// Get minter key
const minter = await askForSecretKey("Minter key");

// Get checker license from user
const recipient = await askForInput("Enter recipient address");
if (!isAddress(recipient)) {
    throw new Error("Invalid recipient address");
}

// Create mint instruction
const mint = new MintChecker({
    minter: minter.address,
    mintReceiver: recipient,
    network: "devnet",
});

// Build and sign transaction
const tx = createTransaction({
    instructions: [await mint.getInstruction()],
    feePayer: minter.address
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

console.log(`Checker minted: ${getExplorerLink({ transaction: signature, cluster: client.network })}`);