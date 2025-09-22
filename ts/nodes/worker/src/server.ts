import { WorkerOfferingSchema } from 'beamable-network-depin';
import cors from '@fastify/cors';
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify from 'fastify';
import { WorkerConfig } from './config.js';
import { registerRoutes } from './routes/index.js';
import { WorkerNode } from './worker.js';
import { ProofSubmitService } from './services/proof-submit-service.js';
import { createLogger, createFastifyLogger } from './logger.js';

const logger = createLogger('WorkerServer');

export class WorkerServer {
  private constructor(
    private readonly fastify: ReturnType<typeof Fastify>,
    private readonly worker: WorkerNode,
    private readonly config: WorkerConfig,
    private submitService: ProofSubmitService
  ) { }

  static async create(config: WorkerConfig): Promise<WorkerServer> {
    const worker = await WorkerNode.create(config);
    // Use our fastify logger configuration
    const fastify = Fastify({
      logger: createFastifyLogger()
    }).withTypeProvider<TypeBoxTypeProvider>();

    // Global BigInt serializer
    fastify.setReplySerializer(function (payload, statusCode) {
      return JSON.stringify(payload, (key, value) =>
        typeof value === 'bigint'
          ? value.toString()
          : value
      );
    });

    const server = new WorkerServer(fastify, worker, config, new ProofSubmitService(worker));
    await server.setupSwagger();
    await server.setupRoutes();
    return server;
  }

  private async setupSwagger() {
    // Register schemas that are referenced by other schemas
    this.fastify.addSchema(WorkerOfferingSchema);

    await this.fastify.register(fastifySwagger, {
      swagger: {
        info: {
          title: 'Worker API',
          description: 'API documentation for the worker',
          version: '1.0.0'
        }
      }
    });

    await this.fastify.register(fastifySwaggerUi, {
      routePrefix: '/documentation'
    });
    logger.debug('Swagger and Swagger UI registered');
  }

  private async setupRoutes() {
    await this.fastify.register(cors, {
      origin: true
    });
    await registerRoutes(this.fastify, this.worker, this.config);
    logger.debug('Routes registered');
  }

  async start(): Promise<void> {
    try {
      // Initialize background proof submission service first.
      // If it fails, do not start the worker or HTTP server.
      await this.submitService.start();

      await this.worker.start();
      await this.fastify.listen({
        port: this.config.port,
        host: this.config.host
      });
    } catch (error) {
      logger.error({ error }, 'Failed to start worker server');
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    if (this.submitService) {
      this.submitService.stop();
    }
    await this.worker.stop();
    await this.fastify.close();
    logger.info('Worker server stopped');
  }
}
