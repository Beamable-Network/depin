import { BMB_MINT, LockedTokensAccount, Unlock } from "@beamable-network/depin";
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import {
    appendTransactionMessageInstruction,
    createTransactionMessage,
    getExplorerLink,
    getSignatureFromTransaction,
    pipe,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners
} from "gill";
import { createClient } from "../client";
import { askForSecretKey } from "../utils";

// Initialize Solana client
const client = await createClient('devnet');

const ownerKey = await askForSecretKey("Tokens owner");

// Fetch all locked token accounts for the current user
console.log("Finding locked token accounts for:", ownerKey.address);
const lockedTokenAccounts = await LockedTokensAccount.getLockedTokens(
    async (program, config) => {
        const resp = await client.rpcClient.rpc.getProgramAccounts(program, config).send();
        return resp.map(({ pubkey, account }) => ({ pubkey, account }));
    },
    ownerKey.address
);

console.log('Found locked token accounts:', lockedTokenAccounts.length);

if (lockedTokenAccounts.length > 0) {
    // Unlock the first account for demo purposes
    const lockedAccount = lockedTokenAccounts[0];
    console.log('\n=== Locked Token Account Details ===');
    console.log('Account Address:', lockedAccount.address.toString());
    console.log('Full Account Object:', JSON.stringify(lockedAccount, null, 2));

    // Find associated token account for receiving unlocked tokens
    const [destinationTokenAccount] = await findAssociatedTokenPda({
        mint: BMB_MINT,
        owner: lockedAccount.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    // Check if destination account needs to be created
    let needsDestinationAccount = false;
    try {
        await client.rpcClient.rpc.getAccountInfo(destinationTokenAccount).send();
    } catch (err) {
        needsDestinationAccount = true;
    }

    // Create unlock instruction
    const unlock = new Unlock({
        owner: lockedAccount.address,
        lock_period: lockedAccount.data.lockPeriod,
        owner_bmb_token_account: destinationTokenAccount,
        unlock_period_for_address: lockedAccount.data.unlockPeriod
    });
    const unlockInstruction = await unlock.getInstruction();

    // Build transaction with conditional ATA creation
    console.log('Creating and Sending Transaction');
    const { value: latestBlockhash } = await client.rpcClient.rpc.getLatestBlockhash().send();

    const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayerSigner(ownerKey, tx),
        (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
        (tx) => {
            if (needsDestinationAccount) {
                return appendTransactionMessageInstruction(
                    getCreateAssociatedTokenIdempotentInstruction({
                        payer: ownerKey,
                        ata: destinationTokenAccount,
                        owner: unlock.owner,
                        mint: BMB_MINT,
                    }),
                    tx
                );
            }
            return tx;
        },
        (tx) => appendTransactionMessageInstruction(unlockInstruction, tx)
    );

    // Sign and send transaction
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    await client.rpcClient.sendAndConfirmTransaction(signedTransaction, {
        commitment: 'confirmed',
        maxRetries: 5n
    });
    const signature = await getSignatureFromTransaction(signedTransaction);
    console.log(`Rewards claimed, locked tokens received: ${getExplorerLink({ transaction: signature, cluster: client.network })}`);
}