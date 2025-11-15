import { getCurrentPeriod, ProofPayloadSchema, SignedPayload, WorkerErrorResponseSchema, WorkerProofListResponseSchema, WorkerProofRequest, WorkerProofRequestSchema, WorkerProofResponse, WorkerProofResponseSchema } from '@beamable-network/depin';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ProofConflictError, ProofNotModifiedError } from '../services/proof-storage.js';
import { WorkerNode } from '../worker.js';
import { createProofReceipt, resolveCheckerLicenseIndex } from './proof.service.js';
import {
    validateCheckerAddress,
    validateCheckerAddressMatch as validateCheckerSigned,
    validateCheckerIP,
    validateCheckerLicense,
    validateCheckerLicenseAddress,
    validateMetrics,
    validateProofPeriod,
    validateProofSignature,
    validateTimestamp,
    validateWorkerLicenseAddress,
    validateWorkerLicenseMatch,
    validateWorkerVersionMatch
} from './proof.validation.js';

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

        // Run all validations
        const validationError =
            await validateProofSignature(proof) ||
            validateMetrics(proof.payload.metrics) ||
            validateCheckerSigned(proof) ||
            validateCheckerAddress(proof.payload.checker.address) ||
            validateTimestamp(proof) ||
            validateCheckerLicenseAddress(proof.payload.checker.license) ||
            validateWorkerLicenseAddress(proof.payload.worker.license) ||
            validateWorkerLicenseMatch(proof, worker.getLicense()) ||
            validateWorkerVersionMatch(proof, worker.getVersion()) ||
            validateCheckerIP(proof, request.ip || request.socket.remoteAddress) ||
            validateProofPeriod(proof.payload.period, currentPeriod) ||
            await validateCheckerLicense(worker, proof.payload.checker.license, proof.payload.checker.address);

        if (validationError) {
            log.warn({ err: validationError }, 'Proof validation failed');
            return reply.code(400).send(validationError);
        }

        // Resolve checker license index
        const licenseResult = await resolveCheckerLicenseIndex(
            worker,
            proof.payload.checker.license,
            proof.payload.period
        );

        if ('error' in licenseResult) {
            return reply.code(400).send(licenseResult.error);
        }

        const checkerLicenseIndex = licenseResult.data.index;
        log.debug({ checkerLicenseIndex }, 'Resolved checker license index');

        // Create proof receipt
        const signedReceipt = await createProofReceipt(
            worker,
            proof.payload.checker.address,
            proof.payload.period
        );

        // Store the proof
        try {
            await worker.getProofStorage().storeProof(checkerLicenseIndex, proof);
            log.debug({ period: proof.payload.period, checkerLicenseIndex }, 'Stored proof');
        } catch (err) {
            if (err instanceof ProofNotModifiedError) {
                log.warn({ period: proof.payload.period, checkerLicenseIndex }, 'Proof not modified');
                return reply.code(200).send({ receipt: signedReceipt });
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
        return reply.code(202).send({ receipt: signedReceipt });
    });
}
