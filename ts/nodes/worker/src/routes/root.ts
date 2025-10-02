import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { WorkerNode } from '../worker.js';
import { WorkerDiscoveryDocument, WorkerDiscoveryDocumentSchema } from '@beamable-network/depin';

import packageJson from '../../package.json' with { type: 'json' };

export async function rootRoutes(fastify: FastifyInstance, { worker }: { worker: WorkerNode }) {
  fastify.get('/', {
    schema: {
      response: {
        200: WorkerDiscoveryDocumentSchema
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply): Promise<WorkerDiscoveryDocument> => {
    const address = worker.getAddress();
    const basePath = worker.getConfig().basePath;

    return {
      version: packageJson.version,
      worker: {
        address,
        license: worker.getLicense(),
        discoveryUri: `${basePath}/`,
        openApi: `${basePath}/documentation`,
        region: worker.getConfig().s3Config.region,
        capabilities: ['compute', 'storage', 'containers']
      },
      endpoints: {
        health: `${basePath}/health`,
        proofs: {
          submit: `${basePath}/proof`,
          listByPeriod: `${basePath}/proofs/:period`
        },
        sla: {
          negotiate: `${basePath}/sla/negotiate`,
          manage: `${basePath}/sla/manage`
        },
        resources: {
          query: `${basePath}/resources`,
          provision: `${basePath}/resources/provision`
        }
      },
      offerings: [
      ],
      metadata: {
        name: 'Beamable DePIN Worker',
        description: 'High-performance compute infrastructure for game workloads',
        contact: {
          email: 'support@beamable.com',
          website: 'https://beamable.com'
        },
        compliance: {
          certifications: ['SOC2'],
          region: worker.getConfig().s3Config.region,
          dataResidency: 'us'
        }
      }
    };
  });
}
