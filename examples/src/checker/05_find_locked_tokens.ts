import { FlexlockTokensAccount } from "@beamable-network/depin";
import { createClient } from "../client";
import { isAddress } from "gill";
import { askForInput } from "../utils";

// Initialize Solana client
const client = await createClient('devnet');

const userAddress = await askForInput("Enter user address");
if (!isAddress(userAddress)) {
    throw new Error("Invalid user address");
}

// Fetch all flexlock token accounts for the current user (as receiver)
const flexlockTokenAccounts = await FlexlockTokensAccount.getFlexlockTokensByReceiver(
    async (programAddress, filters) => {
        const resp = await client.rpcClient.rpc.getProgramAccounts(programAddress, { filters }).send();
        return resp.map((item: any) => ({
            pubkey: item.pubkey,
            account: { data: item.account.data }
        }));
    },
    userAddress
);

console.log('Found flexlock token accounts:', flexlockTokenAccounts.length);

// Display details for each flexlock token account
for (const flexlockAccount of flexlockTokenAccounts) {
    console.log('\n=== Flexlock Token Account Details ===');
    console.log('Account Address:', flexlockAccount.address.toString());
    console.log('Full Account Object:', JSON.stringify(flexlockAccount, null, 2));
}
