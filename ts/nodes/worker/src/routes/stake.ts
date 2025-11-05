import {
    baseUnitsToBmb,
    bmbToBaseUnits,
    decodeStakeInstruction,
    getCheckerTree,
    SignStakeTransactionRequest,
    SignStakeTransactionRequestSchema,
    SignStakeTransactionResponse,
    SignStakeTransactionResponseSchema,
    StakeParams,
    WorkerErrorResponseSchema,
    WORKER_STAKE_PROGRAM
} from '@beamable-network/depin';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
    Address,
    getCompiledTransactionMessageCodec,
    getTransactionDecoder,
    getTransactionEncoder,
    isFullySignedTransaction,
    Transaction
} from 'gill';
import { WorkerNode } from '../worker.js';
import { ValidationError } from './index.js';

async function validateStakeTransaction(transaction: Transaction, worker: WorkerNode): Promise<ValidationError | null> {
    const messageDecoder = getCompiledTransactionMessageCodec();
    const decodedMessage = messageDecoder.decode(transaction.messageBytes);

    // Must have exactly one instruction
    if (!decodedMessage.instructions || decodedMessage.instructions.length !== 1) {
        return {
            error: 'invalid_instruction_count',
            message: `Transaction must contain exactly one instruction, found ${decodedMessage.instructions?.length || 0}`,
            timestamp: Date.now()
        };
    }

    const instruction = decodedMessage.instructions[0];
    const programId = decodedMessage.staticAccounts[instruction.programAddressIndex];

    // Validate program ID is the worker stake program
    if (programId !== WORKER_STAKE_PROGRAM) {
        return {
            error: 'invalid_program',
            message: `Instruction must call the worker stake program (${WORKER_STAKE_PROGRAM}), found ${programId}`,
            timestamp: Date.now()
        };
    }

    // Verify instruction data exists
    const instructionData = instruction.data;
    if (!instructionData || instructionData.length === 0) {
        return {
            error: 'missing_instruction_data',
            message: 'Instruction data is empty',
            timestamp: Date.now()
        };
    }

    // Validate instruction accounts exist
    if (!instruction.accountIndices) {
        return {
            error: 'missing_instruction_accounts',
            message: 'Instruction accounts are missing',
            timestamp: Date.now()
        };
    }

    // Decode stake parameters using the SDK
    let params: StakeParams | undefined;
    let stakerAddress: Address | undefined;
    try {
        params = decodeStakeInstruction(instructionData);
        stakerAddress = decodedMessage.staticAccounts[instruction.accountIndices[1]];
    } catch (err) {
        return {
            error: 'invalid_instruction_params',
            message: `Failed to decode stake parameters: ${err instanceof Error ? err.message : String(err)}`,
            timestamp: Date.now()
        };
    }

    // Validate worker address matches current worker
    if (params.license_context.owner != worker.getAddress()) {
        return {
            error: 'invalid_license_owner',
            message: `License owner (${params.license_context.owner}) does not match this worker (${worker.getAddress()})`,
            timestamp: Date.now()
        };
    }

    // Validate worker account (fee payer) matches worker address
    if (decodedMessage.staticAccounts[instruction.accountIndices[0]] != worker.getAddress()) {
        return {
            error: 'invalid_worker_account',
            message: `Worker account (fee payer) must be the worker address (${worker.getAddress()})`,
            timestamp: Date.now()
        };
    }

    // Validate minimum stake amount (100 BMB)
    if (params.amount <= bmbToBaseUnits(100)) {
        return {
            error: 'invalid_stake_amount',
            message: `Minimum stake amount is 100 BMB, found ${baseUnitsToBmb(params.amount)}`,
            timestamp: Date.now()
        };
    }

    // Fetch and verify user has enough verified checkers
    const result = await worker.getRpcClient().searchAssets({ ownerAddress: stakerAddress, compressed: true });
    const tree = getCheckerTree(worker.getConfig().solanaNetwork);
    const verifiedCheckerCount = result.items.filter(asset => asset.compression?.tree === tree).length;

    if (verifiedCheckerCount < params.checker_count) {
        return {
            error: 'insufficient_checker_assets',
            message: `User has ${verifiedCheckerCount} verified checker assets, but requested ${params.checker_count}`,
            timestamp: Date.now()
        };
    }

    return null;
}

export async function stakeRoutes(fastify: FastifyInstance, { worker }: { worker: WorkerNode }) {
    /**
     * POST /stake/sign
     *
     * Accepts a partially-signed stake transaction from a user and adds the worker's signature.
     * The worker acts as the fee payer for the transaction.
     *
     * Flow:
     * 1. User constructs a stake transaction with worker as fee payer
     * 2. User signs it (authorizing token transfer)
     * 3. User sends base64-encoded transaction to this endpoint
     * 4. Worker validates it's a legitimate stake instruction for this worker with a correct number of checkers
     * 5. Worker signs the transaction (as co-signer and fee payer)
     * 6. Worker returns the fully-signed transaction
     * 7. User submits the transaction to the network
     */
    fastify.post('/stake/sign', {
        schema: {
            body: SignStakeTransactionRequestSchema,
            response: {
                200: SignStakeTransactionResponseSchema,
                400: WorkerErrorResponseSchema
            },
            description: 'Sign a stake transaction as worker (acts as fee payer)',
            tags: ['stake']
        }
    }, async (
        request: FastifyRequest<{ Body: SignStakeTransactionRequest }>,
        reply: FastifyReply
    ): Promise<SignStakeTransactionResponse> => {
        const log = request.log;

        try {
            // Decode the transaction
            const transactionBytes = Buffer.from(request.body.transaction, 'base64');
            const decoder = getTransactionDecoder();
            const transaction = decoder.decode(transactionBytes);

            log.debug('Received transaction for signing');

            const workerAddress = worker.getAddress();

            // Verify user signature exists (at least one signature should be present)
            const userSignatureExists = Object.keys(transaction.signatures).length > 0;
            if (!userSignatureExists) {
                return reply.code(400).send({
                    error: 'missing_user_signature',
                    message: 'User must sign the transaction before sending to worker',
                    timestamp: Date.now()
                });
            }

            // Validate the transaction is a valid stake instruction for this worker
            const validation = await validateStakeTransaction(transaction, worker);
            if (validation) {
                log.warn({ err: validation.error }, 'Transaction validation failed');
                return reply.code(400).send(validation);
            }

            // Check if worker has already signed
            const existingWorkerSig = transaction.signatures[workerAddress];
            const workerAlreadySigned = existingWorkerSig && existingWorkerSig.length === 64; // SignatureBytes is 64 bytes

            if (workerAlreadySigned) {
                // Already signed, just return it
                log.debug('Transaction already signed by worker');
                const encoder = getTransactionEncoder();
                const signedTransactionBytes = encoder.encode(transaction);
                const signedTransactionBase64 = Buffer.from(signedTransactionBytes).toString('base64');

                return reply.code(200).send({
                    transaction: signedTransactionBase64
                });
            }

            // Sign the transaction with the worker's key
            const [workerSignatures] = await worker.getSigner().signTransactions([transaction]);
            const signedTransaction = {
                ...transaction,
                signatures: { ...transaction.signatures, ...workerSignatures }
            };

            if (!isFullySignedTransaction(signedTransaction)) {
                return reply.code(400).send({
                    error: 'incomplete_signatures',
                    message: 'Transaction is not fully signed after worker signature',
                    timestamp: Date.now()
                });
            }

            // Simulate the transaction to verify it will succeed
            log.debug('Simulating stake transaction before returning');
            const simulationResult = await worker.getRpcClient().simulateTransaction(signedTransaction);

            if (simulationResult.err) {
                log.error({ err: simulationResult.err, logs: simulationResult.logs }, 'Transaction simulation failed');
                return reply.code(400).send({
                    error: 'simulation_failed',
                    message: `Transaction simulation failed: ${JSON.stringify(simulationResult.logs)}`,
                    timestamp: Date.now()
                });
            }

            log.debug({ logs: simulationResult.logs }, 'Transaction simulation succeeded');

            // Serialize the signed transaction
            const encoder = getTransactionEncoder();
            const signedTransactionBytes = encoder.encode(signedTransaction);
            const signedTransactionBase64 = Buffer.from(signedTransactionBytes).toString('base64');

            log.info({ signers: Object.keys(signedTransaction.signatures) }, 'Stake transaction signed');

            return reply.code(200).send({
                transaction: signedTransactionBase64
            });

        } catch (err) {
            log.error({ err }, 'Error signing stake transaction');

            return reply.code(400).send({
                error: 'signing_failed',
                message: `Failed to sign transaction: ${err instanceof Error ? err.message : String(err)}`,
                timestamp: Date.now()
            });
        }
    });
}
