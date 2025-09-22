import { FastifyInstance } from 'fastify';
import { WorkerConfig } from '../config.js';
import { WorkerNode } from '../worker.js';
import { healthRoutes } from './health.js';
import { proofRoutes } from './proof.js';
import { rootRoutes as rootRoute } from './root.js';

export async function registerRoutes(fastify: FastifyInstance, worker: WorkerNode, config: WorkerConfig) {
  await fastify.register(rootRoute, { worker });
  await fastify.register(healthRoutes, { worker });
  await fastify.register(proofRoutes, { worker });
}