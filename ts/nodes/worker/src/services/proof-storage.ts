import { GetObjectCommand, type GetObjectCommandOutput, HeadObjectCommand, ListObjectsV2Command, type ListObjectsV2CommandOutput, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SignedPayload, ProofPayloadSchema, type WorkerProofListResponse, getCurrentPeriod } from '@beamable-network/depin';
import { WorkerConfig } from '../config.js';
import { getLogger } from '../logger.js';
import { AsyncCache } from '../utils/async-cache.js';

const logger = getLogger('ProofStorage');

export class ProofStorageService {
  private s3Client: S3Client;
  private bucketName: string;
  private bucketPath: string;
  private cache: AsyncCache<number, WorkerProofListResponse>;

  constructor(config: WorkerConfig) {
    // Cache last 10 periods with 30 min TTL
    this.cache = new AsyncCache({
      max: 10,
      ttl: 30 * 60 * 1000, // 30 minutes in milliseconds
      ttlAutopurge: true
    });
    const s3Config: any = {
      region: config.s3Config.region,
      useDualstackEndpoint: true, // Required for IPv6-only subnets
    };

    if (config.s3Config.accessKeyId && config.s3Config.secretAccessKey) {
      s3Config.credentials = {
        accessKeyId: config.s3Config.accessKeyId,
        secretAccessKey: config.s3Config.secretAccessKey,
      };
    }

    this.s3Client = new S3Client(s3Config);
    this.bucketName = config.s3Config.bucketName;
    this.bucketPath = config.s3Config.bucketPath;
  }

  private getKey(path: string): string {
    if (this.bucketPath) {
      return `${this.bucketPath}/${path}`;
    }
    return path;
  }

  async storeProof(checkerLicenseIndex: number, proof: SignedPayload<typeof ProofPayloadSchema>): Promise<void> {
    const period = proof.payload.period;
    const key = this.getKey(`${period}/${checkerLicenseIndex}`);
    const proofJson = JSON.stringify(proof);

    try {
      logger.debug({ key, period, checkerLicenseIndex }, 'Checking if proof already exists');
      
      // Try to get the existing proof to compare content
      const existingProof = await this.s3Client.send(new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key
      }));

      // Convert existing proof body to string and parse
      const existingBody: any = existingProof.Body as any;
      const existingJson = await streamToString(existingBody);
      const existingParsed = JSON.parse(existingJson);
      
      // Compare with new proof
      const existingProofJson = JSON.stringify(existingParsed);
      
      if (proofJson === existingProofJson) {
        throw new ProofNotModifiedError(`Identical proof already saved for period ${period} and checker ${checkerLicenseIndex}`);
      } else {
        throw new ProofConflictError(`Different proof already exists for period ${period} and checker ${checkerLicenseIndex}`);
      }
    } catch (err) {
      if (err instanceof ProofNotModifiedError || err instanceof ProofConflictError) {
        throw err;
      }

      if ((err as any).name !== 'NoSuchKey' && (err as any).name !== 'NotFound') {
        throw new Error(`Failed to check if proof exists: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    try {
      logger.debug({ key, period, checkerLicenseIndex, sizeBytes: Buffer.byteLength(proofJson, 'utf8') }, 'Storing proof');
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: proofJson,
        ContentType: 'application/json'
      }));
      logger.debug({ key, period, checkerLicenseIndex }, 'Proof stored');
      
      // Clear cache for this period since new proof was added
      this.cache.delete(period);
    } catch (err) {
      throw new Error(`Failed to store proof to S3: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listProofsByPeriod(period: number): Promise<WorkerProofListResponse> {
    // Only cache last 10 periods
    const currentPeriod = getCurrentPeriod();
    const shouldCache = period >= currentPeriod - 9 && period <= currentPeriod;

    if (!shouldCache) {
      // Don't cache old periods, fetch directly
      return this.fetchProofsFromS3(period);
    }

    // Use cache with automatic deduplication for concurrent requests
    return this.cache.get(period, () => this.fetchProofsFromS3(period));
  }

  private async fetchProofsFromS3(period: number): Promise<WorkerProofListResponse> {
    const prefix = this.getKey(`${period}/`);

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

          proofs.push(parsed as SignedPayload<typeof ProofPayloadSchema>);
        }
      } while (continuationToken);
      logger.debug({ period, count: proofs.length, ms: Date.now() - start }, 'Listed proofs by period');
    } catch (err) {
      throw new Error(`Failed to list proofs for period ${period}: ${err instanceof Error ? err.message : String(err)}`);
    }

    return proofs;
  }
}

export class ProofConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProofConflictError';
  }
}

export class ProofNotModifiedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProofNotModifiedError';
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
