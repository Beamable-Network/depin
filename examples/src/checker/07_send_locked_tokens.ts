import { BMB_DECIMALS, BMB_MINT, FlexLock, getCurrentPeriod } from "@beamable-network/depin";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
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

const senderKey = await askForSecretKey("Sender (who has BMB tokens)");

const receiverAddress = await askForInput("Enter receiver address");
if (!isAddress(receiverAddress)) {
    throw new Error("Invalid receiver address");
}

const amountInput = await askForInput("Enter amount of BMB to lock (e.g., 100)");
const amount = BigInt(amountInput) * 10n ** BigInt(BMB_DECIMALS); // Convert to base units

const lockDaysInput = await askForInput("Enter lock duration in days (e.g., 90)");
const lockDurationDays = parseInt(lockDaysInput);

// Find sender's BMB token account
const [senderTokenAccount] = await findAssociatedTokenPda({
    mint: BMB_MINT,
    owner: senderKey.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
});

// Get current period
const currentPeriod = getCurrentPeriod();

console.log('\n=== Flexlock Details ===');
console.log('Sender:', senderKey.address);
console.log('Receiver:', receiverAddress);
console.log('Amount:', `${amountInput} BMB`);
console.log('Lock Duration:', `${lockDurationDays} days`);
console.log('Current Period:', currentPeriod);
console.log('Unlock Period:', currentPeriod + lockDurationDays);

// Create flexlock instruction
const flexLock = new FlexLock({
    sender: senderKey.address,
    receiver: receiverAddress,
    amount: amount,
    lock_duration_days: lockDurationDays,
    sender_bmb_token_account: senderTokenAccount,
    current_period: currentPeriod,
});

// Build and sign transaction
const tx = createTransaction({
    instructions: [await flexLock.getInstruction()],
    feePayer: senderKey
});

const { value: latestBlockhash } = await client.rpcClient.rpc.getLatestBlockhash().send();
const signedTransaction = await signTransactionMessageWithSigners(
    setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx)
);

// Send transaction and display result
console.log('\nSending transaction...');
const signature = await client.rpcClient.sendAndConfirmTransaction(signedTransaction, {
    commitment: "confirmed",
    maxRetries: 5n
});

console.log(`\nSuccess! Locked tokens sent to ${receiverAddress}`);
console.log(`Transaction: ${getExplorerLink({ transaction: signature, cluster: client.network })}`);
console.log(`\nThe receiver can unlock these tokens after period ${currentPeriod + lockDurationDays}`);
