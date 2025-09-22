import { Address, Base58EncodedBytes, Codec, getAddressEncoder, getArrayCodec, getBase58Codec, getProgramDerivedAddress, getStructCodec, getU16Codec, getU32Codec, getU64Codec, getU8Codec, ProgramDerivedAddress } from 'gill';
import { DEPIN_PROGRAM, PROOF_SEED } from '../../constants.js';
import { DepinAccountType } from '../../enums.js';

export class WorkerProofAccount {
    period: number;
    proofRoot: number[];
    checkers: bigint[];
    uptime: number;
    latency: number;

    constructor(fields: {
        period: number;
        proofRoot: number[];
        checkers: bigint[];
        uptime: number;
        latency: number;
    }) {
        this.period = fields.period;
        this.proofRoot = fields.proofRoot;
        this.checkers = fields.checkers;
        this.uptime = fields.uptime;
        this.latency = fields.latency;
    }

    public static readonly DataCodec: Codec<WorkerProofAccount> = getStructCodec([
        ["period", getU16Codec()],
        ["proofRoot", getArrayCodec(getU8Codec(), { size: 32 })],
        ["checkers", getArrayCodec(getU64Codec(), { size: 8 })],
        ["uptime", getU32Codec()],
        ["latency", getU32Codec()],
    ]);

    public static deserializeFrom(accountData: ArrayLike<number>): WorkerProofAccount;
    public static deserializeFrom(accountDataBase58: Base58EncodedBytes): WorkerProofAccount;
    public static deserializeFrom(accountData: ArrayLike<number> | Base58EncodedBytes): WorkerProofAccount {
        let accountDataBuffer: ArrayLike<number>;

        if (typeof accountData === 'string') {
            accountDataBuffer = getBase58Codec().encode(accountData);
        } else {
            accountDataBuffer = accountData;
        }

        const accountDiscriminator = accountDataBuffer[0];
        if (accountDiscriminator !== DepinAccountType.WorkerProof) {
            throw new Error(`Invalid discriminator: ${accountDiscriminator}`);
        }

        const data = Buffer.from(accountDataBuffer).subarray(1); // Skip the first byte (discriminator)
        const result = this.DataCodec.decode(data);
        return result;
    }

    public static readonly LEN: bigint = BigInt(107); // 1 + 2 + 32 + 64 + 4 + 4

    public static async findWorkerProofPDA(workerLicense: Address, period: number): Promise<ProgramDerivedAddress> {
        const pda = await getProgramDerivedAddress({
            programAddress: DEPIN_PROGRAM,
            seeds: [
                PROOF_SEED,
                getU16Codec().encode(period),
                getAddressEncoder().encode(workerLicense)
            ]
        });
        return pda;
    }
}

const addressEncoder = getAddressEncoder();

export async function findWorkerProofPDA(workerLicense: Address, period: number): Promise<ProgramDerivedAddress> {
    return WorkerProofAccount.findWorkerProofPDA(workerLicense, period);
}
