import { BMBStateAccount, SignedPayload, WorkerProofReceiptPayloadSchema } from '@beamable-network/depin';
import { publicKey } from '@metaplex-foundation/umi';
import { WorkerNode } from '../worker.js';
import { ValidationError } from './index.js';
import { createErrorResponse } from './proof.validation.js';

export interface CheckerLicenseInfo {
    index: number;
}

export async function resolveCheckerLicenseIndex(
    worker: WorkerNode,
    checkerLicense: string,
    period: number
): Promise<{ data: CheckerLicenseInfo } | { error: ValidationError }> {
    try {
        const licenseAsset = await worker.getUmi().rpc.getAsset(publicKey(checkerLicense));

        // Verify the checker license is activated
        const bmbStateResult = await BMBStateAccount.readFromStateCached(async (address) => {
            const accountData = await worker.getUmi().rpc.getAccount(publicKey(address));
            if (!accountData?.exists) return null;
            return accountData.data;
        });

        if (bmbStateResult == null) {
            return {
                error: createErrorResponse(
                    'bmb_state_unavailable',
                    'Failed to fetch BMB state account data'
                )
            };
        }

        const checkerCount = bmbStateResult.data.getCheckerCountForPeriod(period);
        if (checkerCount == null) {
            return {
                error: createErrorResponse(
                    'checker_count_unavailable',
                    `No checker count found for period ${period}`
                )
            };
        }

        if (licenseAsset.compression.leaf_id >= checkerCount) {
            return {
                error: createErrorResponse(
                    'invalid_checker_license',
                    'The provided checker license is not activated in BMBState'
                )
            };
        }

        return {
            data: {
                index: licenseAsset.compression.leaf_id
            }
        };
    } catch (err) {
        return {
            error: createErrorResponse(
                'checker_license_unavailable',
                `Failed to fetch checker license asset: ${err instanceof Error ? err.message : String(err)}`
            )
        };
    }
}

export async function createProofReceipt(
    worker: WorkerNode,
    checkerAddress: string,
    period: number
): Promise<SignedPayload<typeof WorkerProofReceiptPayloadSchema>> {
    return await SignedPayload.create<typeof WorkerProofReceiptPayloadSchema>(
        {
            checker: checkerAddress,
            timestamp: Date.now(),
            worker: worker.getAddress(),
            period: period,
            type: 'proof_receipt'
        },
        worker.getSigner()
    );
}
