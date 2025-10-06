import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { NodeSDK } from '@opentelemetry/sdk-node';

import packageJson from '../package.json' with { type: 'json' };

/**
 * Initialize OpenTelemetry instrumentation.
 * This function will only activate OTEL if the required environment variables are set.
 *
 * Required environment variables:
 * - OTEL_EXPORTER_OTLP_ENDPOINT: The OTLP collector endpoint (e.g., http://localhost:4318)
 *
 * Optional environment variables:
 * - OTEL_EXPORTER_OTLP_HEADERS: Additional headers for the OTLP exporter
 */
export function initializeOTEL(): NodeSDK | null {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  // If OTEL endpoint is not configured, skip initialization
  if (!endpoint) {
    return null;
  }

  const serviceName = packageJson.name;

  // Initialize the SDK with auto-instrumentation
  const sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    }),
    logRecordProcessor: new BatchLogRecordProcessor(new OTLPLogExporter({
      url: `${endpoint}/v1/logs`,
    })),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Automatically instrument Fastify, Pino, HTTP, and other Node.js libraries
        '@opentelemetry/instrumentation-fs': {
          enabled: false, // File system instrumentation can be very noisy
        },
        '@opentelemetry/instrumentation-pino': {
          enabled: true,
        },
        '@opentelemetry/instrumentation-http': {
          enabled: true,
        },
        '@opentelemetry/instrumentation-fastify': {
          enabled: true,
        },
        '@opentelemetry/instrumentation-aws-sdk': {
          enabled: true,
          suppressInternalInstrumentation: false,
        },
      }),
    ],
  });

  sdk.start();

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    try {
      await sdk.shutdown();
    } catch (error) {
      console.error('Error shutting down OTEL SDK', error);
    }
  });

  return sdk;
}
