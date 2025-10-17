import { CheckerLicenseMetadataAccount, CheckerMetadataAccount, ProofPayloadSchema, SignedPayload, timestampToPeriod } from '@beamable-network/depin';
import { DasApiAsset, DasApiError } from '@metaplex-foundation/digital-asset-standard-api';
import { publicKey } from '@metaplex-foundation/umi';
import { address, isAddress, isSome } from 'gill';
import { isPrivateIP } from '../utils/network.js';
import { withRetry } from '../utils/retry.js';
import { WorkerNode } from '../worker.js';

export interface ValidationError {
    error: string;
    message: string;
    timestamp: number;
}

export function createErrorResponse(error: string, message: string): ValidationError {
    return { error, message, timestamp: Date.now() };
}

export async function validateProofSignature(proof: SignedPayload<typeof ProofPayloadSchema>): Promise<ValidationError | null> {
    if (!await proof.verify()) {
        return createErrorResponse(
            'invalid_proof_signature',
            'The provided proof signature is not valid'
        );
    }
    return null;
}

export function validateMetrics(metrics: { latency: number; uptime: number }): ValidationError | null {
    if (metrics.latency <= 0 || metrics.uptime < 0) {
        return createErrorResponse(
            'invalid_metrics',
            'Latency must be positive and uptime cannot be negative'
        );
    }

    if (metrics.uptime > 100) {
        return createErrorResponse(
            'invalid_metrics',
            'Uptime cannot be greater than 100%'
        );
    }

    if (metrics.latency > 30000) {
        return createErrorResponse(
            'invalid_metrics',
            'Latency cannot exceed 30 seconds'
        );
    }

    return null;
}

export function validateCheckerAddressMatch(proof: SignedPayload<typeof ProofPayloadSchema>): ValidationError | null {
    if (proof.payload.checker.address != proof.publicKey) {
        return createErrorResponse(
            'checker_address_mismatch',
            'The checker address in the proof payload does not match the public key of the signature'
        );
    }
    return null;
}

export function validateCheckerAddress(checkerAddress: string): ValidationError | null {
    if (!isAddress(checkerAddress)) {
        return createErrorResponse(
            'invalid_checker_address',
            'The checker field must be a valid Solana wallet address'
        );
    }
    return null;
}

export function validateTimestamp(proof: SignedPayload<typeof ProofPayloadSchema>): ValidationError | null {
    const now = Date.now();
    const timeDiff = Math.abs(now - proof.payload.timestamp);
    const maxAllowedDiff = 60 * 1000; // 60 seconds in milliseconds

    if (timeDiff > maxAllowedDiff) {
        return createErrorResponse(
            'invalid_timestamp',
            `Timestamp is ${Math.round(timeDiff / 1000)}s apart from current time. Maximum allowed is 60s. Check your system clock.`
        );
    }

    // Validate timestamp: must be in the same period as the proof
    const timestampPeriod = timestampToPeriod(BigInt(Math.floor(proof.payload.timestamp / 1000)));
    if (timestampPeriod !== proof.payload.period) {
        return createErrorResponse(
            'invalid_proof_timestamp',
            `Proof timestamp must be in the same period as the proof (timestamp period: ${timestampPeriod}, proof period: ${proof.payload.period})`
        );
    }

    return null;
}

export function validateCheckerLicenseAddress(checkerLicense: string): ValidationError | null {
    if (!isAddress(checkerLicense)) {
        return createErrorResponse(
            'invalid_checker_license',
            'The checker license field must be a valid Solana wallet address'
        );
    }
    return null;
}

export function validateWorkerLicenseAddress(workerLicense: string): ValidationError | null {
    if (!isAddress(workerLicense)) {
        return createErrorResponse(
            'invalid_worker_license',
            'The worker license field must be a valid Solana wallet address'
        );
    }
    return null;
}

export function validateWorkerLicenseMatch(proof: SignedPayload<typeof ProofPayloadSchema>, workerLicense: string): ValidationError | null {
    if (proof.payload.worker.license !== workerLicense) {
        return createErrorResponse(
            'worker_license_mismatch',
            'The worker license in the proof does not match the worker\'s actual license'
        );
    }
    return null;
}

export function validateWorkerVersionMatch(proof: SignedPayload<typeof ProofPayloadSchema>, workerVersion: string): ValidationError | null {
    if (proof.payload.worker.version !== workerVersion) {
        return createErrorResponse(
            'worker_version_mismatch',
            'The worker version in the proof does not match the worker\'s actual version'
        );
    }
    return null;
}

export function validateCheckerIP(proof: SignedPayload<typeof ProofPayloadSchema>, requestSourceIp?: string): ValidationError | null {
    if (!requestSourceIp) {
        return createErrorResponse(
            'invalid_request_source_ip',
            'The request source IP is unavailable'
        );
    }

    if (isPrivateIP(requestSourceIp)) {
        return createErrorResponse(
            'invalid_request_source_ip',
            'The request source IP is private, cannot verify checker IP'
        );
    }

    if (proof.payload.checker.ip !== requestSourceIp) {
        return createErrorResponse(
            'checker_ip_mismatch',
            'The checker IP in the proof does not match the request source IP'
        );
    }

    return null;
}

export function validateProofPeriod(proofPeriod: number, currentPeriod: number): ValidationError | null {
    if (proofPeriod !== currentPeriod) {
        return createErrorResponse(
            'invalid_proof_period',
            `The proof period must be the current period (${currentPeriod})`
        );
    }
    return null;
}

export async function validateCheckerLicense(worker: WorkerNode, checkerLicense: string, checker: string): Promise<ValidationError | null> {
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
        return createErrorResponse('invalid_checker_license', 'Can\'t fetch checker license asset');
    }

    const checkerMetadataPda = await CheckerMetadataAccount.findCheckerMetadataPDA(address(checkerLicense), address(licenseAsset.ownership.owner));
    const checkerMetadataAccount = await worker.getUmi().rpc.getAccount(publicKey(checkerMetadataPda[0]));
    if (!checkerMetadataAccount.exists) {
        return createErrorResponse('invalid_checker_license', 'The provided checker license is not activated');
    }
    const checkerMetadata = CheckerMetadataAccount.deserializeFrom(checkerMetadataAccount.data);

    if (isSome(checkerMetadata.suspendedAt)) {
        return createErrorResponse('checker_suspended', 'The provided checker is suspended');
    }

    if (checkerMetadata.delegatedTo !== checker) {
        return createErrorResponse('invalid_checker_license', 'The provided checker license is not delegated to the checker address');
    }

    const checkerLicenseMetadataPda = await CheckerLicenseMetadataAccount.findCheckerLicenseMetadataPDA(address(checkerLicense));
    const checkerLicenseMetadataAccount = await worker.getUmi().rpc.getAccount(publicKey(checkerLicenseMetadataPda[0]));
    if (checkerLicenseMetadataAccount.exists) {
        const checkerLicenseMetadata = CheckerLicenseMetadataAccount.deserializeFrom(checkerLicenseMetadataAccount.data);
        if (isSome(checkerLicenseMetadata.suspendedAt)) {
            return createErrorResponse('checker_license_suspended', 'The provided checker license is suspended');
        }
    }

    return null;
}
