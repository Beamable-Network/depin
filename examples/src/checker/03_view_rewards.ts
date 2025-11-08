import { GlobalRewardsAccount } from "@beamable-network/depin";
import { publicKey } from "@metaplex-foundation/umi";
import { askForInput } from "../utils";
import { createClient } from "../client";
import { isAddress } from "gill";

// Initialize Solana client
const client = await createClient('devnet');

// Get checker license from user
const licenseAddress = await askForInput("Enter checker license");
if (!isAddress(licenseAddress)) {
    throw new Error("Invalid license address");
}
const license = await client.umi.rpc.getAsset(publicKey(licenseAddress));

// Fetch global rewards account
const globalRewardsAccountPda = await GlobalRewardsAccount.findGlobalRewardsPDA();
const globalRewardsAccountInfo = await client.rpcClient.rpc.getAccountInfo(globalRewardsAccountPda[0]).send();

if (!globalRewardsAccountInfo.value) {
    console.log("Network isn't initialized");
    process.exit(0);
}

// Display pending rewards for this checker
const globalRewardsAccount = GlobalRewardsAccount.deserializeFrom(globalRewardsAccountInfo.value.data);
const pendingReward = globalRewardsAccount.checkers[license.compression.leaf_id];
console.log(`Pending rewards: ${pendingReward}`);