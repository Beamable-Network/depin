import { PayoutCheckerRewards, TreasuryConfigAccount } from "@beamable-network/depin";
import { getAssetWithProof } from "@metaplex-foundation/mpl-bubblegum";
import { publicKey } from "@metaplex-foundation/umi";
import {
    createTransaction,
    getExplorerLink,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners
} from "gill";
import { askForInput } from "utils";
import { createClient } from "../client";

// Initialize Solana client
const client = await createClient('devnet');

// Get checker license from user
const licenseAddress = await askForInput("Enter checker license");
const license = await getAssetWithProof(client.umi, publicKey(licenseAddress));

// Create payout instruction
const payout = new PayoutCheckerRewards({
    signer: client.signer.address,
    checker_license: license
});

// Fetch treasury config
const cfg = await TreasuryConfigAccount.readFromState(async (addr) => {
    const info = await client.rpcClient.rpc.getAccountInfo(addr).send();
    return info.value?.data ?? null;
});

if (!cfg) {
    console.log("Network isn't initialized");
    process.exit(0);
}

// Build and sign transaction
const tx = createTransaction({
    instructions: [await payout.getInstruction(cfg)],
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

console.log(`Rewards claimed, locked tokens received: ${getExplorerLink({ transaction: signature, cluster: client.network })}`);