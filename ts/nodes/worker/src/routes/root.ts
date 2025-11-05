import { WorkerDiscoveryDocument, WorkerDiscoveryDocumentSchema } from '@beamable-network/depin';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { WorkerNode } from '../worker.js';

export async function rootRoutes(fastify: FastifyInstance, { worker }: { worker: WorkerNode }) {
  fastify.get('', {
    schema: {
      response: {
        200: WorkerDiscoveryDocumentSchema
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply): Promise<WorkerDiscoveryDocument> => {
    const address = worker.getAddress();
    const config = worker.getConfig();

    return {
      worker: {
        version: worker.getVersion(),
        address,
        license: worker.getLicense(),
        discoveryUri: `${config.urlPath('')}`,
        openApi: `${config.urlPath('documentation')}`,
        region: worker.getConfig().s3Config.region,
        capabilities: ['compute', 'storage', 'containers']
      },
      endpoints: {
        health: `${config.urlPath('health')}`,
        proofs: {
          submit: `${config.urlPath('proof')}`,
          listByPeriod: `${config.urlPath('proofs/:period')}`
        },
        stake: {
          sign: `${config.urlPath('stake/sign')}`
        },
        sla: {
          negotiate: `${config.urlPath('sla/negotiate')}`,
          manage: `${config.urlPath('sla/manage')}`
        },
        resources: {
          query: `${config.urlPath('resources')}`,
          provision: `${config.urlPath('resources/provision')}`
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
          region: worker.getConfig().s3Config.region
        }
      }
    };
  });
}
