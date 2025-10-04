import { HealthCheckReceiptPayloadSchema, SignedPayload, WorkerErrorResponseSchema, WorkerHealthCheckRequest, WorkerHealthCheckRequestPayloadSchema, WorkerHealthCheckRequestSchema, WorkerHealthCheckResponse, WorkerHealthCheckResponseSchema } from '@beamable-network/depin';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isAddress } from 'gill';
import { WorkerNode } from '../worker.js';

export async function healthRoutes(fastify: FastifyInstance, { worker }: { worker: WorkerNode }) {
  fastify.post('/health', {
    schema: {
      body: WorkerHealthCheckRequestSchema,
      response: {
        200: WorkerHealthCheckResponseSchema,
        400: WorkerErrorResponseSchema
      }
    }
  }, async (request: FastifyRequest<{ Body: WorkerHealthCheckRequest }>, reply: FastifyReply): Promise<WorkerHealthCheckResponse> => {
    const healtcheck = new SignedPayload<typeof WorkerHealthCheckRequestPayloadSchema>(request.body);
    const log = request.log;
    log.info({ checker: healtcheck.payload.checker, timestamp: healtcheck.payload.timestamp }, 'Health check request received');

    // Verify signature
    if (!await healtcheck.verify()) {
      log.warn('Health check signature verification failed');
      return reply.code(400).send({
        error: 'invalid_signature',
        message: 'The provided signature is not valid for the given payload',
        timestamp: Date.now()
      });
    }

    const checker = healtcheck.payload.checker;

    // Verify checker address matches the signer
    if (checker !== healtcheck.publicKey) {
      log.warn({ checker, publicKey: healtcheck.publicKey }, 'Checker address mismatch');
      return reply.code(400).send({
        error: 'checker_address_mismatch',
        message: 'The checker address in the payload does not match the public key of the signature',
        timestamp: Date.now()
      });
    }

    // Verify timestamp is within 60 seconds of current time
    const now = Date.now();
    const timeDiff = Math.abs(now - healtcheck.payload.timestamp);
    const maxAllowedDiff = 60 * 1000; // 60 seconds in milliseconds

    if (timeDiff > maxAllowedDiff) {
      log.warn({ timeDiffMs: timeDiff }, 'Health check timestamp too far from current time');
      return reply.code(400).send({
        error: 'invalid_timestamp',
        message: `Timestamp is ${Math.round(timeDiff / 1000)}s apart from current time. Maximum allowed is 60s. Check you system clock.`,
        timestamp: Date.now()
      });
    }

    // Verify checker address is a valid Solana address
    if (!isAddress(checker)) {
      log.warn({ checker }, 'Invalid checker address');
      return reply.code(400).send({
        error: 'invalid_checker_address',
        message: 'The checker field must be a valid Solana wallet address',
        timestamp: Date.now()
      });
    }

    // All checks passed, return health status
    const health = await worker.healthCheck();
    log.debug({
      uptime: health.systemMetrics.uptime,
      cpuCores: health.systemMetrics.cpu.cores,
      memPercent: Math.round(health.systemMetrics.memory.percentage)
    }, 'Health check computed');

    const receipt = await SignedPayload.create<typeof HealthCheckReceiptPayloadSchema>(
      {
        checker: checker,
        timestamp: now,
        worker: worker.getAddress(),
        type: 'health_check_receipt'
      },
      worker.getSigner()
    );

    log.debug({ checker, worker: worker.getAddress() }, 'Health check successful');
    return {
      ...health,
      receipt
    };
  });
}
