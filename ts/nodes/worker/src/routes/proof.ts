import { BMBStateAccount, CheckerLicenseMetadataAccount, CheckerMetadataAccount, getCurrentPeriod, SignedPayload, WorkerErrorResponseSchema, WorkerProofListResponseSchema, WorkerProofPayloadSchema, WorkerProofReceiptPayloadSchema, WorkerProofRequest, WorkerProofRequestSchema, WorkerProofResponse, WorkerProofResponseSchema } from '@beamable-network/depin';
import { publicKey } from '@metaplex-foundation/umi';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Address, isAddress, isSome } from 'gill';
import { ProofAlreadyExistsError } from '../services/proof-storage.js';
import { WorkerNode } from '../worker.js';

export async function proofRoutes(fastify: FastifyInstance, { worker }: { worker: WorkerNode }) {
    fastify.get('/proofs/:period', {
        schema: {
            response: {
                200: WorkerProofListResponseSchema,
                400: WorkerErrorResponseSchema
            }
        }
    }, async (request: FastifyRequest<{ Params: { period: string } }>, reply: FastifyReply) => {
        const { period } = request.params;
        const parsed = Number.parseInt(period, 10);

        if (!Number.isFinite(parsed) || parsed < 0) {
            return reply.code(400).send({
                error: 'invalid_period',
                message: 'The period path parameter must be a non-negative integer',
                timestamp: Date.now()
            });
        }

        try {
            const proofsWithIndex = await worker.getProofStorage().listProofsByPeriod(parsed);
            return reply.code(200).send(proofsWithIndex);
        } catch (err) {
            return reply.code(400).send({
                error: 'proof_fetch_failed',
                message: `Failed to fetch proofs: ${err instanceof Error ? err.message : String(err)}`,
                timestamp: Date.now()
            });
        }
    });

    fastify.post('/proof', {
        schema: {
            body: WorkerProofRequestSchema,
            response: {
                200: WorkerProofResponseSchema,
                400: WorkerErrorResponseSchema
            }
        }
    }, async (request: FastifyRequest<{ Body: WorkerProofRequest }>, reply: FastifyReply): Promise<WorkerProofResponse> => {

        const currentPeriod = getCurrentPeriod();

        const proof = new SignedPayload<typeof WorkerProofPayloadSchema>(request.body);
        const log = request.log;
        log.debug({ checker: proof.payload.checker, period: proof.payload.period }, 'Proof submission received');

        // Verify signature
        if (!await proof.verify()) {
            log.warn('Invalid proof signature');
            return reply.code(400).send({
                error: 'invalid_proof_signature',
                message: 'The provided proof signature is not valid',
                timestamp: Date.now()
            });
        }

        // Validate metrics
        const metricsValidationError = validateMetrics(proof.payload.metrics);
        if (metricsValidationError) {
            log.warn({ metrics: proof.payload.metrics }, 'Invalid metrics');
            return reply.code(400).send({
                error: metricsValidationError.error,
                message: metricsValidationError.message,
                timestamp: Date.now()
            });
        }

        // Verify checker address matches the signer
        if (proof.payload.checker != proof.publicKey) {
            log.warn({ checker: proof.payload.checker, publicKey: proof.publicKey }, 'Checker address mismatch');
            return reply.code(400).send({
                error: 'checker_address_mismatch',
                message: 'The checker address in the proof payload does not match the public key of the signature',
                timestamp: Date.now()
            });
        }

        // Verify checker address is a valid Solana address
        if (!isAddress(proof.payload.checker)) {
            log.warn({ checker: proof.payload.checker }, 'Invalid checker address');
            return reply.code(400).send({
                error: 'invalid_checker_address',
                message: 'The checker field must be a valid Solana wallet address',
                timestamp: Date.now()
            });
        }

        // Verify checker license address is a valid Solana address
        if (!isAddress(proof.payload.checkerLicense)) {
            log.warn({ checkerLicense: proof.payload.checkerLicense }, 'Invalid checker license address');
            return reply.code(400).send({
                error: 'invalid_checker_license',
                message: 'The checker license field must be a valid Solana wallet address',
                timestamp: Date.now()
            });
        }

        // Verify proof period is the current period
        if (proof.payload.period !== currentPeriod) {
            log.warn({ expected: currentPeriod, got: proof.payload.period }, 'Invalid proof period');
            return reply.code(400).send({
                error: 'invalid_proof_period',
                message: `The proof period must be the current period (${currentPeriod})`,
                timestamp: Date.now()
            });
        }

        // Validate checker license and delegation
        const licenseValidationError = await validateCheckerLicense(worker, proof.payload.checkerLicense, proof.payload.checker);
        if (licenseValidationError) {
            if (licenseValidationError.error !== 'checker_suspended' && licenseValidationError.error !== 'checker_license_suspended') {
                log.warn({ error: licenseValidationError.error }, 'Checker license validation failed');
            } else {
                log.info({ error: licenseValidationError.error }, 'Checker or license suspended');
            }
            return reply.code(400).send({
                error: licenseValidationError.error,
                message: licenseValidationError.message,
                timestamp: Date.now()
            });
        }

        // Fetch checker asset to get the index
        let checkerLicenseIndex = 0;
        try {
            const licenseAsset = await worker.getUmi().rpc.getAsset(publicKey(proof.payload.checkerLicense));

            // Verify the checker license is activated
            const bmbStateResult = await BMBStateAccount.readFromStateCached(async (address) => {
                const accountData = await worker.getUmi().rpc.getAccount(publicKey(address));
                if (!accountData?.exists) return null;
                return accountData.data;
            });
            if (bmbStateResult == null) {
                return reply.code(400).send({
                    error: 'bmb_state_unavailable',
                    message: 'Failed to fetch BMB state account data',
                    timestamp: Date.now()
                });
            }

            const checkerCount = bmbStateResult.data.getCheckerCountForPeriod(proof.payload.period);
            if (checkerCount == null) {
                return reply.code(400).send({
                    error: 'checker_count_unavailable',
                    message: `No checker count found for period ${proof.payload.period}`,
                    timestamp: Date.now()
                });
            }

            if (licenseAsset.compression.seq > checkerCount) {
                return reply.code(400).send({
                    error: 'invalid_checker_license',
                    message: 'The provided checker license is not activated in BMBState',
                    timestamp: Date.now()
                });
            }

            // Save the checker index
            checkerLicenseIndex = licenseAsset.compression.seq;
            log.debug({ checkerLicenseIndex }, 'Resolved checker license index');
        } catch (err) {
            return reply.code(400).send({
                error: 'checker_license_unavailable',
                message: `Failed to fetch checker license asset: ${err instanceof Error ? err.message : String(err)}`,
                timestamp: Date.now()
            });
        }

        // Store the proof
        try {
            await worker.getProofStorage().storeProof(checkerLicenseIndex, proof);
            log.debug({ period: proof.payload.period, checkerLicenseIndex }, 'Stored proof');
        } catch (err) {
            if (err instanceof ProofAlreadyExistsError) {
                log.warn({ period: proof.payload.period, checkerLicenseIndex }, 'Duplicate proof');
                return reply.code(400).send({
                    error: 'proof_already_exists',
                    message: 'A proof has already been submitted for this checker license and period',
                    timestamp: Date.now()
                });
            }
            return reply.code(400).send({
                error: 'proof_storage_failed',
                message: `Failed to store proof: ${err instanceof Error ? err.message : String(err)}`,
                timestamp: Date.now()
            });
        }

        // Return signed receipt
        const signedReceipt = await SignedPayload.create<typeof WorkerProofReceiptPayloadSchema>(
            {
                checker: proof.payload.checker,
                timestamp: Date.now(),
                worker: worker.getAddress(),
                period: proof.payload.period,
                type: 'proof_receipt'
            },
            worker.getSigner()
        );

        log.debug({ checker: proof.payload.checker, period: proof.payload.period }, 'Proof accepted');
        return reply.code(200).send({
            receipt: signedReceipt
        });
    });
}

function validateMetrics(metrics: { latency: number; uptime: number }): { error: string; message: string } | null {
    if (metrics.latency <= 0 || metrics.uptime < 0) {
        return {
            error: 'invalid_metrics',
            message: 'Latency must be positive and uptime cannot be negative'
        };
    }

    if (metrics.uptime > 100) {
        return {
            error: 'invalid_metrics',
            message: 'Uptime cannot be greater than 100%'
        };
    }

    if (metrics.latency > 30000) {
        return {
            error: 'invalid_metrics',
            message: 'Latency cannot exceed 30 seconds'
        };
    }

    return null;
}

async function validateCheckerLicense(worker: WorkerNode, checkerLicense: Address, checker: Address): Promise<{ error: string; message: string } | null> {
    const checkerMetadataPda = await CheckerMetadataAccount.findCheckerMetadataPDA(checkerLicense, checker);
    const checkerMetadataAccount = await worker.getUmi().rpc.getAccount(publicKey(checkerMetadataPda[0]));
    if (!checkerMetadataAccount.exists) {
        return { error: 'invalid_checker_license', message: 'The provided checker license is not activated' };
    }
    const checkerMetadata = CheckerMetadataAccount.deserializeFrom(checkerMetadataAccount.data);

    if (isSome(checkerMetadata.suspendedAt)) {
        return { error: 'checker_suspended', message: 'The provided checker is suspended' };
    }

    if (checkerMetadata.delegatedTo !== checker) {
        return { error: 'invalid_checker_license', message: 'The provided checker license is not delegated to the checker address' };
    }

    const checkerLicenseMetadataPda = await CheckerLicenseMetadataAccount.findCheckerLicenseMetadataPDA(checkerLicense);
    const checkerLicenseMetadataAccount = await worker.getUmi().rpc.getAccount(publicKey(checkerLicenseMetadataPda[0]));
    if (checkerLicenseMetadataAccount.exists) {
        const checkerLicenseMetadata = CheckerLicenseMetadataAccount.deserializeFrom(checkerLicenseMetadataAccount.data);
        if (isSome(checkerLicenseMetadata.suspendedAt)) {
            return { error: 'checker_license_suspended', message: 'The provided checker license is suspended' };
        }
    }

    return null;
}
