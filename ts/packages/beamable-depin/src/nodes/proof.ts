import { Type } from "@sinclair/typebox";
import { SignatureWithPayloadSchema } from "../signatures/signature.js";

export const ProofPayloadSchema = Type.Object({
  period: Type.Number({ description: 'Depin period' }),
  timestamp: Type.Number({ description: 'Timestamp in epoch milliseconds' }),
  checker: Type.Object({
    address: Type.String({ description: 'Checker wallet address' }),
    license: Type.String({ description: 'Checker license NFT address' }),
    index: Type.Number({ description: 'Checker license index' }),
    ip: Type.String({ description: 'Checker external IP address' }),
    version: Type.String({ description: 'Checker software version' }),
  }),
  worker: Type.Object({
    address: Type.String({ description: 'Worker wallet address' }),
    license: Type.String({ description: 'Worker license NFT address' }),
    ip: Type.String({ description: 'Worker IP address' }),
    version: Type.String({ description: 'Worker software version' }),
  }),
  metrics: Type.Object({
    latency: Type.Number({ description: 'Response time in ms' }),
    uptime: Type.Number({ description: 'Uptime in percentage' }),
  })
});

export const SignedProoftSchema = SignatureWithPayloadSchema(ProofPayloadSchema);