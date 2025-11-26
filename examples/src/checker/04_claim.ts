import { PayoutCheckerRewards, CheckerRewardsVault } from "@beamable-network/depin";
import { getAssetWithProof } from "@metaplex-foundation/mpl-bubblegum";
import { publicKey } from "@metaplex-foundation/umi";
import {
    createTransaction,
    getExplorerLink,
    isAddress,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners
} from "gill";
import { askForInput, askForSecretKey } from "../utils";
import { createClient } from "../client";

// Initialize Solana client
const client = await createClient('devnet');

// Get license owner or delegate signer
const licenseOwner = await askForSecretKey("License owner or delegate");

// Get checker license from user
const licenseAddress = await askForInput("Enter checker license");
if (!isAddress(licenseAddress)) {
    throw new Error("Invalid license address");
}
const license = await getAssetWithProof(client.umi, publicKey(licenseAddress), { truncateCanopy: true });

// Create payout instruction
const payout = new PayoutCheckerRewards({
    signer: licenseOwner.address,
    checker_license: license
});

// Fetch checker rewards vault config
const cfg = await CheckerRewardsVault.readFromState(async (addr) => {
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
    feePayer: licenseOwner
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

console.log(`Rewards claimed, flexlock tokens received: ${getExplorerLink({ transaction: signature, cluster: client.network })}`);