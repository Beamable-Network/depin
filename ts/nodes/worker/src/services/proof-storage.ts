import { GetObjectCommand, type GetObjectCommandOutput, HeadObjectCommand, ListObjectsV2Command, type ListObjectsV2CommandOutput, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SignedPayload, WorkerProofPayloadSchema, type WorkerProofListResponse } from '@beamable-network/depin';
import { WorkerConfig } from '../config.js';
import { getLogger } from '../logger.js';

const logger = getLogger('ProofStorage');

export class ProofStorageService {
  private s3Client: S3Client;
  private bucketName: string;

  constructor(config: WorkerConfig) {
    const s3Config: any = {
      region: config.s3Config.region,
    };

    if (config.s3Config.accessKeyId && config.s3Config.secretAccessKey) {
      s3Config.credentials = {
        accessKeyId: config.s3Config.accessKeyId,
        secretAccessKey: config.s3Config.secretAccessKey,
      };
    }

    this.s3Client = new S3Client(s3Config);
    this.bucketName = config.s3Config.bucketName;
  }

  async storeProof(checkerLicenseIndex: number, proof: SignedPayload<typeof WorkerProofPayloadSchema>): Promise<void> {
    const period = proof.payload.period;
    const key = `${period}/${checkerLicenseIndex}`;

    try {
      logger.debug({ key, period, checkerLicenseIndex }, 'Checking if proof already exists');
      await this.s3Client.send(new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key
      }));

      throw new ProofAlreadyExistsError(`Proof already exists for period ${period} and checker ${checkerLicenseIndex}`);
    } catch (err) {
      if (err instanceof ProofAlreadyExistsError) {
        throw err;
      }

      if ((err as any).name !== 'NotFound') {
        throw new Error(`Failed to check if proof exists: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const proofJson = JSON.stringify(proof);

    try {
      logger.debug({ key, period, checkerLicenseIndex, sizeBytes: Buffer.byteLength(proofJson, 'utf8') }, 'Storing proof');
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: proofJson,
        ContentType: 'application/json'
      }));
      logger.debug({ key, period, checkerLicenseIndex }, 'Proof stored');
    } catch (err) {
      throw new Error(`Failed to store proof to S3: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listProofsByPeriod(period: number): Promise<WorkerProofListResponse> {
    const prefix = `${period}/`;

    const proofs: WorkerProofListResponse = [];
    let continuationToken: string | undefined = undefined;
    const start = Date.now();

    try {
      do {
        const list: ListObjectsV2CommandOutput = await this.s3Client.send(new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken
        }));

        continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;

        const contents = list.Contents || [];
        for (const obj of contents) {
          if (!obj.Key) continue;

          // Extract checker index from filename (now without .json extension)
          const checkerIndex = parseInt(obj.Key.substring(prefix.length), 10);
          if (!Number.isFinite(checkerIndex)) continue;

          const get: GetObjectCommandOutput = await this.s3Client.send(new GetObjectCommand({
            Bucket: this.bucketName,
            Key: obj.Key
          }));

          // Convert body to string
          const body: any = get.Body as any;
          const json = await streamToString(body);
          const parsed = JSON.parse(json);

          proofs.push({
            checkerIndex,
            proof: parsed as SignedPayload<typeof WorkerProofPayloadSchema>
          });
        }
      } while (continuationToken);
      logger.debug({ period, count: proofs.length, ms: Date.now() - start }, 'Listed proofs by period');
    } catch (err) {
      throw new Error(`Failed to list proofs for period ${period}: ${err instanceof Error ? err.message : String(err)}`);
    }

    return proofs;
  }
}

export class ProofAlreadyExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProofAlreadyExistsError';
  }
}

async function streamToString(stream: any): Promise<string> {
  if (!stream) return '';
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on('error', (err: any) => reject(err));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}
