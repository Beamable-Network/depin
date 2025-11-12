import { Address, appendTransactionMessageInstructions, createSolanaRpc, createTransactionMessage, getBase64EncodedWireTransaction, Instruction, partiallySignTransactionMessageWithSigners, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash } from "gill";

export async function queryProgramReturnData(
    rpcUrl: string, caller: Address, instruction: Instruction): Promise<Uint8Array> {
    const rpc = createSolanaRpc(rpcUrl);

    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    // Build the transaction (use System Program as fee payer since it always exists)
    const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayer(caller, tx),
        (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
        (tx) => appendTransactionMessageInstructions([instruction], tx)
    );

    // Sign the transaction (even though it's just a simulation)
    const partiallySignedTransaction = await partiallySignTransactionMessageWithSigners(transactionMessage);

    // Add a dummy signature
    const signedTransaction = {
        ...partiallySignedTransaction,
        signatures: {
            ...partiallySignedTransaction.signatures,
            [caller]: new Uint8Array(64) as any
        }
    };

    // Encode to base64 for simulation
    const encodedTransaction = getBase64EncodedWireTransaction(signedTransaction);

    // Simulate the transaction
    const simulationResult = await rpc.simulateTransaction(
        encodedTransaction,
        {
            encoding: "base64",
            commitment: "confirmed",
            sigVerify: false,
        }
    ).send();

    // Check for errors
    if (simulationResult.value.err) {
        throw new Error(`Simulation failed: ${JSON.stringify(simulationResult.value.err)}`);
    }

    // Extract return data
    const returnData = simulationResult.value.returnData;
    if (!returnData) {
        throw new Error("No return data from simulation");
    }

    return Buffer.from(returnData.data[0], "base64");
}