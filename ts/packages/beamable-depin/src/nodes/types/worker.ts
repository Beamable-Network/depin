import { Static, Type } from '@sinclair/typebox';
import { SignatureWithPayloadSchema } from '../../signatures/signature.js';

// Define schemas first
export const OfferingTypeSchema = Type.Union([
  Type.Literal('compute'),
  Type.Literal('storage'),
  Type.Literal('network'),
  Type.Literal('container')
], { description: 'Type of offering' });

export const StorageTypeSchema = Type.Union([
  Type.Literal('ssd'),
  Type.Literal('hdd'),
  Type.Literal('nvme')
], { description: 'Storage type' });

export const CurrencySchema = Type.Union([
  Type.Literal('USDC'),
  Type.Literal('BMB')
], { description: 'Pricing currency' });

export const PricingUnitSchema = Type.Union([
  Type.Literal('hour'),
  Type.Literal('day'),
  Type.Literal('month'),
  Type.Literal('gb'),
  Type.Literal('request')
], { description: 'Pricing unit' });

export const SlaLevelSchema = Type.Union([
  Type.Literal('basic'),
  Type.Literal('standard'),
  Type.Literal('premium')
], { description: 'SLA level' });

// Derive types from schemas
export type OfferingType = Static<typeof OfferingTypeSchema>;
export type StorageType = Static<typeof StorageTypeSchema>;
export type Currency = Static<typeof CurrencySchema>;
export type PricingUnit = Static<typeof PricingUnitSchema>;
export type SlaLevel = Static<typeof SlaLevelSchema>;

export const WorkerOfferingSchema = Type.Object({
  id: Type.String({ description: 'Unique offering identifier' }),
  type: OfferingTypeSchema,
  name: Type.String({ description: 'Offering name' }),
  description: Type.String({ description: 'Offering description' }),
  specifications: Type.Object({
    cpu: Type.Optional(Type.Object({
      cores: Type.Number({ description: 'Number of CPU cores' }),
      architecture: Type.String({ description: 'CPU architecture' }),
      frequency: Type.Optional(Type.String({ description: 'CPU frequency' })),
    })),
    memory: Type.Optional(Type.Object({
      total: Type.Number({ description: 'Total memory in GB' }),
      type: Type.Optional(Type.String({ description: 'Memory type' })),
    })),
    storage: Type.Optional(Type.Object({
      total: Type.Number({ description: 'Total storage in GB' }),
      type: StorageTypeSchema,
    })),
    network: Type.Optional(Type.Object({
      bandwidth: Type.Number({ description: 'Bandwidth in Mbps' }),
      latency: Type.Optional(Type.Number({ description: 'Latency in ms' })),
    })),
    gpu: Type.Optional(Type.Object({
      model: Type.String({ description: 'GPU model' }),
      memory: Type.Number({ description: 'GPU memory in GB' }),
      count: Type.Number({ description: 'Number of GPUs' }),
    })),
  }),
  pricing: Type.Object({
    currency: CurrencySchema,
    rate: Type.Number({ description: 'Price rate' }),
    unit: PricingUnitSchema,
  }),
  availability: Type.Object({
    uptime: Type.Number({ description: 'Uptime percentage' }),
    regions: Type.Array(Type.String(), { description: 'Available regions' }),
    slaLevel: SlaLevelSchema,
  }),
}, { $id: 'WorkerOffering' });

export type WorkerOffering = Static<typeof WorkerOfferingSchema>;

export const WorkerDiscoveryDocumentSchema = Type.Object({
  version: Type.String({ description: 'API version' }),
  worker: Type.Object({
    address: Type.String({ description: 'Worker wallet address' }),
    license: Type.String({ description: 'Worker license NFT address' }),
    discoveryUri: Type.String({ description: 'Discovery endpoint URI' }),
    openApi: Type.String({ description: 'OpenAPI documentation URI' }),
    region: Type.Optional(Type.String({ description: 'Deployment region' })),
    capabilities: Type.Optional(Type.Array(Type.String(), { description: 'Worker capabilities' })),
  }),
  endpoints: Type.Object({
    health: Type.String({ description: 'Health check endpoint' }),
    proofs: Type.Object({
      submit: Type.String({ description: 'Proof submission endpoint' }),
      listByPeriod: Type.String({ description: 'List proofs by period endpoint' }),
    }),
    sla: Type.Object({
      negotiate: Type.String({ description: 'SLA negotiation endpoint' }),
      manage: Type.String({ description: 'SLA management endpoint' }),
    }),
    resources: Type.Object({
      query: Type.String({ description: 'Resource query endpoint' }),
      provision: Type.String({ description: 'Resource provisioning endpoint' }),
    }),
  }),
  offerings: Type.Array(Type.Ref('WorkerOffering'), { description: 'Available worker offerings' }),
  metadata: Type.Object({
    name: Type.String({ description: 'Worker service name' }),
    description: Type.String({ description: 'Worker service description' }),
    contact: Type.Optional(Type.Object({
      email: Type.Optional(Type.String({ description: 'Contact email' })),
      website: Type.Optional(Type.String({ description: 'Contact website' })),
    })),
    compliance: Type.Optional(Type.Object({
      certifications: Type.Optional(Type.Array(Type.String(), { description: 'Compliance certifications' })),
      region: Type.Optional(Type.String({ description: 'Compliance region' })),
      dataResidency: Type.Optional(Type.String({ description: 'Data residency location' })),
    })),
  }),
});

export type WorkerDiscoveryDocument = Static<typeof WorkerDiscoveryDocumentSchema>;

export const WorkerHealthCheckRequestPayloadSchema = Type.Object({
  timestamp: Type.Number({ description: 'Epoch milliseconds' }),
  checker: Type.String({ description: 'Wallet address' })
});

export type WorkerHealthCheckRequestPayload = Static<typeof WorkerHealthCheckRequestPayloadSchema>;

export const WorkerHealthCheckRequestSchema = SignatureWithPayloadSchema(WorkerHealthCheckRequestPayloadSchema);

export type WorkerHealthCheckRequest = Static<typeof WorkerHealthCheckRequestSchema>;

export const HealthCheckReceiptPayloadSchema = Type.Object({
  type: Type.Literal('health_check_receipt'),
  checker: Type.String({ description: 'Checker wallet address' }),
  timestamp: Type.Number({ description: 'Timestamp when health check was performed' }),
  worker: Type.String({ description: 'Worker wallet address' }),
});

export type HealthCheckReceiptPayload = Static<typeof HealthCheckReceiptPayloadSchema>;

export const WorkerHealthCheckResponseSchema = Type.Object({
  receipt: SignatureWithPayloadSchema(HealthCheckReceiptPayloadSchema),
  systemMetrics: Type.Object({
    uptime: Type.Number(),
    cpu: Type.Object({
      usage: Type.Number({ description: 'Percentage' }),
      cores: Type.Number(),
    }),
    memory: Type.Object({
      used: Type.Number({ description: 'GB' }),
      total: Type.Number({ description: 'GB' }),
      percentage: Type.Number(),
    }),
  }),
});

export type WorkerHealthCheckResponse = Static<typeof WorkerHealthCheckResponseSchema>;

export const WorkerErrorResponseSchema = Type.Object({
  error: Type.String({ description: 'Error type identifier' }),
  message: Type.String({ description: 'Human-readable error message' }),
  timestamp: Type.Number({ description: 'Timestamp epoch milliseconds' }),
});

export type WorkerErrorResponse = Static<typeof WorkerErrorResponseSchema>;

export const WorkerProofPayloadSchema = Type.Object({
  checker: Type.String({ description: 'Checker wallet address' }),
  checkerLicense: Type.String({ description: 'Wallet address' }),
  worker: Type.String({ description: 'Worker wallet address' }),
  period: Type.Number({ description: 'Depin period' }),
  metrics: Type.Object({
    latency: Type.Number({ description: 'Response time in ms' }),
    uptime: Type.Number({ description: 'Uptime in percentage' }),
  })
});

export type WorkerProofPayload = Static<typeof WorkerProofPayloadSchema>;

export const WorkerProofRequestSchema = SignatureWithPayloadSchema(WorkerProofPayloadSchema);

export type WorkerProofRequest = Static<typeof WorkerProofRequestSchema>;

export const WorkerProofReceiptPayloadSchema = Type.Object({
  type: Type.Literal('proof_receipt'),
  checker: Type.String({ description: 'Checker wallet address' }),
  timestamp: Type.Number({ description: 'Timestamp when proof sent' }),
  worker: Type.String({ description: 'Worker wallet address' }),
  period: Type.Number({ description: 'Depin period' }),
});

export type WorkerProofReceipt = Static<typeof WorkerProofReceiptPayloadSchema>;

export const WorkerProofResponseSchema = Type.Object({
  receipt: SignatureWithPayloadSchema(WorkerProofReceiptPayloadSchema),
});

export type WorkerProofResponse = Static<typeof WorkerProofResponseSchema>;

// List proofs response for a given period
export const WorkerProofWithIndexSchema = Type.Object({
  checkerIndex: Type.Number(),
  proof: SignatureWithPayloadSchema(WorkerProofPayloadSchema)
});

export const WorkerProofListResponseSchema = Type.Array(WorkerProofWithIndexSchema);
export type WorkerProofListResponse = Static<typeof WorkerProofListResponseSchema>;
