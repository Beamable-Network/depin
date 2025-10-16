import { BMBStateAccount, CheckerLicenseMetadataAccount, CheckerMetadataAccount, getCurrentPeriod, ProofPayloadSchema, SignedPayload, timestampToPeriod, WorkerErrorResponseSchema, WorkerProofListResponseSchema, WorkerProofReceiptPayloadSchema, WorkerProofRequest, WorkerProofRequestSchema, WorkerProofResponse, WorkerProofResponseSchema } from '@beamable-network/depin';
import { DasApiAsset, DasApiError } from '@metaplex-foundation/digital-asset-standard-api';
import { publicKey } from '@metaplex-foundation/umi';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { address, Address, isAddress, isSome } from 'gill';
import { ProofConflictError, ProofNotModifiedError } from '../services/proof-storage.js';
import { isPrivateIP } from '../utils/network.js';
import { withRetry } from '../utils/retry.js';
import { WorkerNode } from '../worker.js';

export async function proofRoutes(fastify: FastifyInstance, { worker }: { worker: WorkerNode }) {
    fastify.get('/proofs/:period', {
        schema: {
            response: {
                202: WorkerProofListResponseSchema,
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

        const proof = new SignedPayload<typeof ProofPayloadSchema>(request.body);
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
        if (proof.payload.checker.address != proof.publicKey) {
            log.warn({ checker: proof.payload.checker, publicKey: proof.publicKey }, 'Checker address mismatch');
            return reply.code(400).send({
                error: 'checker_address_mismatch',
                message: 'The checker address in the proof payload does not match the public key of the signature',
                timestamp: Date.now()
            });
        }

        // Verify checker address is a valid Solana address
        if (!isAddress(proof.payload.checker.address)) {
            log.warn({ checker: proof.payload.checker }, 'Invalid checker address');
            return reply.code(400).send({
                error: 'invalid_checker_address',
                message: 'The checker field must be a valid Solana wallet address',
                timestamp: Date.now()
            });
        }

        // Verify timestamp is within 60 seconds of current time
        const now = Date.now();
        const timeDiff = Math.abs(now - proof.payload.timestamp);
        const maxAllowedDiff = 60 * 1000; // 60 seconds in milliseconds

        if (timeDiff > maxAllowedDiff) {
            log.warn({ timeDiffMs: timeDiff }, 'Proof timestamp too far from current time');
            return reply.code(400).send({
                error: 'invalid_timestamp',
                message: `Timestamp is ${Math.round(timeDiff / 1000)}s apart from current time. Maximum allowed is 60s. Check your system clock.`,
                timestamp: Date.now()
            });
        }

        // Validate timestamp: must be in the same period as the proof
        const timestampPeriod = timestampToPeriod(BigInt(Math.floor(proof.payload.timestamp / 1000)));
        if (timestampPeriod !== proof.payload.period) {
            log.warn({
                checker: proof.payload.checker,
                proofPeriod: proof.payload.period,
                timestampPeriod,
                timestamp: proof.payload.timestamp
            }, 'Proof timestamp does not match proof period');
            return reply.code(400).send({
                error: 'invalid_proof_timestamp',
                message: `Proof timestamp must be in the same period as the proof (timestamp period: ${timestampPeriod}, proof period: ${proof.payload.period})`,
                timestamp: Date.now()
            });
        }

        // Verify checker license address is a valid Solana address
        if (!isAddress(proof.payload.checker.license)) {
            log.warn({ checkerLicense: proof.payload.checker.license }, 'Invalid checker license address');
            return reply.code(400).send({
                error: 'invalid_checker_license',
                message: 'The checker license field must be a valid Solana wallet address',
                timestamp: Date.now()
            });
        }

        // Verify worker license address is a valid Solana address
        if (!isAddress(proof.payload.worker.license)) {
            log.warn({ workerLicense: proof.payload.worker.license }, 'Invalid worker license address');
            return reply.code(400).send({
                error: 'invalid_worker_license',
                message: 'The worker license field must be a valid Solana wallet address',
                timestamp: Date.now()
            });
        }

        // Verify worker license matches the worker's actual license
        const workerLicense = worker.getLicense();
        if (proof.payload.worker.license !== workerLicense) {
            log.warn({
                workerLicenseInProof: proof.payload.worker.license,
                actualWorkerLicense: workerLicense
            }, 'Worker license mismatch');
            return reply.code(400).send({
                error: 'worker_license_mismatch',
                message: 'The worker license in the proof does not match the worker\'s actual license',
                timestamp: Date.now()
            });
        }

        // Verify checker IP
        const requestSourceIp = request.ip || request.socket.remoteAddress;
        if (!requestSourceIp) {
            log.warn('Request source IP is unavailable');
            return reply.code(400).send({
                error: 'invalid_request_source_ip',
                message: 'The request source IP is unavailable',
                timestamp: Date.now()
            });
        }
        if (isPrivateIP(requestSourceIp)) {
            log.warn({ requestSourceIp }, 'Request source IP is private, cannot verify checker IP. Make sure your proxy sets the x-forwarded-for if behind a proxy.');
            return reply.code(400).send({
                error: 'invalid_request_source_ip',
                message: 'The request source IP is private, cannot verify checker IP',
                timestamp: Date.now()
            });
        }
        if (!requestSourceIp || proof.payload.checker.ip !== requestSourceIp) {
            log.warn({
                checkerIpInProof: proof.payload.checker.ip,
                requestSourceIp: requestSourceIp
            }, 'Checker IP mismatch');
            return reply.code(400).send({
                error: 'checker_ip_mismatch',
                message: 'The checker IP in the proof does not match the request source IP',
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
        const licenseValidationError = await validateCheckerLicense(worker, proof.payload.checker.license, proof.payload.checker.address);
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
            const licenseAsset = await worker.getUmi().rpc.getAsset(publicKey(proof.payload.checker.license));

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

            if (licenseAsset.compression.leaf_id >= checkerCount) {
                return reply.code(400).send({
                    error: 'invalid_checker_license',
                    message: 'The provided checker license is not activated in BMBState',
                    timestamp: Date.now()
                });
            }

            // Save the checker index
            checkerLicenseIndex = licenseAsset.compression.leaf_id;
            log.debug({ checkerLicenseIndex }, 'Resolved checker license index');
        } catch (err) {
            return reply.code(400).send({
                error: 'checker_license_unavailable',
                message: `Failed to fetch checker license asset: ${err instanceof Error ? err.message : String(err)}`,
                timestamp: Date.now()
            });
        }

        const signedReceipt = await SignedPayload.create<typeof WorkerProofReceiptPayloadSchema>(
            {
                checker: proof.payload.checker.address,
                timestamp: Date.now(),
                worker: worker.getAddress(),
                period: proof.payload.period,
                type: 'proof_receipt'
            },
            worker.getSigner()
        );

        // Store the proof
        try {
            await worker.getProofStorage().storeProof(checkerLicenseIndex, proof);
            log.debug({ period: proof.payload.period, checkerLicenseIndex }, 'Stored proof');
        } catch (err) {
            if (err instanceof ProofNotModifiedError) {
                log.warn({ period: proof.payload.period, checkerLicenseIndex }, 'Proof not modified');
                // Return signed receipt
                return reply.code(200).send({
                    receipt: signedReceipt
                });
            }
            if (err instanceof ProofConflictError) {
                log.warn({ period: proof.payload.period, checkerLicenseIndex }, 'Proof conflict');
                return reply.code(400).send({
                    error: 'proof_conflict',
                    message: `A different proof has already been submitted for period ${proof.payload.period} and checker ${checkerLicenseIndex}`,
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
        log.debug({ checker: proof.payload.checker, period: proof.payload.period }, 'Proof accepted');
        return reply.code(202).send({
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
    let licenseAsset: DasApiAsset;
    try {
        licenseAsset = await withRetry(async () => {
            return await worker.getUmi().rpc.getAsset(publicKey(checkerLicense));
        }, {
            maxRetries: 5,
            baseDelayMs: 500,
            exponentialBackoff: true,
            shouldRetry: (err) => {
                // Don't retry if asset is not found
                return !(err instanceof DasApiError && (err.message.startsWith('Asset not found')));
            }
        });
    }
    catch (err) {
        return { error: 'invalid_checker_license', message: 'Can\'t fetch checker license asset' };
    }

    const checkerMetadataPda = await CheckerMetadataAccount.findCheckerMetadataPDA(checkerLicense, address(licenseAsset.ownership.owner));
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
