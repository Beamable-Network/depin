import { LockedTokensAccount } from "@beamable-network/depin";
import { address } from "gill";
import { createClient } from "../client";

// Initialize Solana client
const client = await createClient('mainnet');

// Fetch all locked token accounts for the current user
const lockedTokenAccounts = await LockedTokensAccount.getLockedTokens(
    async (program, config) => {
        const resp = await client.rpcClient.rpc.getProgramAccounts(program, config).send();
        return resp.map(({ pubkey, account }) => ({ pubkey, account }));
    },
    address(client.umiSigner.publicKey)
);

console.log('Found locked token accounts:', lockedTokenAccounts.length);

// Display details for each locked token account
for (const lockedAccount of lockedTokenAccounts) {
    console.log('\n=== Locked Token Account Details ===');
    console.log('Account Address:', lockedAccount.address.toString());
    console.log('Full Account Object:', JSON.stringify(lockedAccount, null, 2));
}