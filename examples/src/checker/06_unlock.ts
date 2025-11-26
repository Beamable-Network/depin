import { BMB_MINT, FlexlockTokensAccount, FlexUnlock, getCurrentPeriod } from "@beamable-network/depin";
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

const receiverKey = await askForSecretKey("Tokens receiver (who will unlock)");

// Fetch all flexlock token accounts for the receiver
console.log("Finding flexlock token accounts for:", receiverKey.address);
const flexlockTokenAccounts = await FlexlockTokensAccount.getFlexlockTokensByReceiver(
    async (programAddress, filters) => {
        const resp = await client.rpcClient.rpc.getProgramAccounts(programAddress, { filters }).send();
        return resp.map((item: any) => ({
            pubkey: item.pubkey,
            account: { data: item.account.data }
        }));
    },
    receiverKey.address
);

console.log('Found flexlock token accounts:', flexlockTokenAccounts.length);

if (flexlockTokenAccounts.length > 0) {
    // Unlock the first account for demo purposes
    const flexlockAccount = flexlockTokenAccounts[0];
    console.log('\n=== Flexlock Token Account Details ===');
    console.log('Account Address:', flexlockAccount.address.toString());
    console.log('Full Account Object:', JSON.stringify(flexlockAccount, null, 2));

    // Find associated token accounts for receiver and sender
    const [receiverTokenAccount] = await findAssociatedTokenPda({
        mint: BMB_MINT,
        owner: flexlockAccount.data.receiver,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const [senderTokenAccount] = await findAssociatedTokenPda({
        mint: BMB_MINT,
        owner: flexlockAccount.data.sender,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    // Check if receiver destination account needs to be created
    let needsReceiverAccount = false;
    try {
        await client.rpcClient.rpc.getAccountInfo(receiverTokenAccount).send();
    } catch (err) {
        needsReceiverAccount = true;
    }

    // Check if sender destination account needs to be created (for porential penalty return)
    let needsSenderAccount = false;
    if (flexlockAccount.data.unlockPeriod > getCurrentPeriod()) {
        try {
            await client.rpcClient.rpc.getAccountInfo(senderTokenAccount).send();
        } catch (err) {
            needsSenderAccount = true;
        }
    }

    // Create unlock instruction
    const unlock = new FlexUnlock({
        receiver: flexlockAccount.data.receiver,
        sender: flexlockAccount.data.sender,
        receiver_bmb_token_account: receiverTokenAccount,
        sender_bmb_token_account: senderTokenAccount,
        lock_period: flexlockAccount.data.lockPeriod,
        rent_receiver: flexlockAccount.data.rentReceiver,
        unlock_period: flexlockAccount.data.unlockPeriod
    });
    const unlockInstruction = await unlock.getInstruction();

    // Build transaction with conditional ATA creation
    console.log('Creating and Sending Transaction');
    const { value: latestBlockhash } = await client.rpcClient.rpc.getLatestBlockhash().send();

    const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayerSigner(receiverKey, tx),
        (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
        (tx) => {
            if (needsReceiverAccount) {
                return appendTransactionMessageInstruction(
                    getCreateAssociatedTokenIdempotentInstruction({
                        payer: receiverKey,
                        ata: receiverTokenAccount,
                        owner: flexlockAccount.data.receiver,
                        mint: BMB_MINT,
                    }),
                    tx
                );
            }
            return tx;
        },
        (tx) => {
            if (needsSenderAccount) {
                return appendTransactionMessageInstruction(
                    getCreateAssociatedTokenIdempotentInstruction({
                        payer: receiverKey,
                        ata: senderTokenAccount,
                        owner: flexlockAccount.data.sender,
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
    console.log(`Flexlock tokens unlocked: ${getExplorerLink({ transaction: signature, cluster: client.network })}`);
}
