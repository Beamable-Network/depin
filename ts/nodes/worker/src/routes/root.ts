import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { WorkerNode } from '../worker.js';
import { WorkerDiscoveryDocument, WorkerDiscoveryDocumentSchema } from '@beamable-network/depin';

export async function rootRoutes(fastify: FastifyInstance, { worker }: { worker: WorkerNode }) {
  fastify.get('/', {
    schema: {
      response: {
        200: WorkerDiscoveryDocumentSchema
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply): Promise<WorkerDiscoveryDocument> => {
    const address = worker.getAddress();
    const host = request.headers.host || 'localhost';
    const protocol = request.headers['x-forwarded-proto'] || (request.protocol === 'https' ? 'https' : 'http');
    const baseUrl = `${protocol}://${host}`;

    return {
      version: '1.0.0',
      worker: {
        address,
        license: worker.getLicense(),
        discoveryUri: `${baseUrl}/`,
        openApi: `${baseUrl}/documentation`,
        region: 'us-east-1',
        capabilities: ['compute', 'storage', 'containers']
      },
      endpoints: {
        health: `${baseUrl}/health`,
        proofs: {
          submit: `${baseUrl}/proof`,
          listByPeriod: `${baseUrl}/proofs/:period`
        },
        sla: {
          negotiate: `${baseUrl}/sla/negotiate`,
          manage: `${baseUrl}/sla/manage`
        },
        resources: {
          query: `${baseUrl}/resources`,
          provision: `${baseUrl}/resources/provision`
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
          region: 'us-east-1',
          dataResidency: 'us'
        }
      }
    };
  });
}
