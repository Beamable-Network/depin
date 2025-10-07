import { createAddHookMessageChannel } from 'import-in-the-middle';
import { register } from 'module';

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

import packageJson from '../package.json' with { type: 'json' };

import dotenv from 'dotenv';
import { dirname, join } from 'path';

const moduleDir = dirname(import.meta.dirname);
const envPath = join(moduleDir, '.env');
dotenv.config({ path: envPath });

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

const { registerOptions, waitForAllMessagesAcknowledged } = createAddHookMessageChannel();
register('import-in-the-middle/hook.mjs', import.meta.url, registerOptions);

/**
 * Initialize OpenTelemetry instrumentation.
 * This function will only activate OTEL if the required environment variable is set.
 *
 * Required environment variable:
 * - OTEL_EXPORTER_OTLP_ENDPOINT: The GRPC OTLP collector endpoint (e.g., http://localhost:4317)
 */
function initializeOTEL(): NodeSDK | null {
  // If OTEL endpoint is not configured, skip initialization
  if (!endpoint) {
    return null;
  }

  const serviceName = packageJson.name;
  const serviceVersion = packageJson.version;

  const instrumentations = [...getNodeAutoInstrumentations({
    "@opentelemetry/instrumentation-pino": {
      disableLogSending: false,
      disableLogCorrelation: false
    },
    "@opentelemetry/instrumentation-http": {
      enabled: true,
      ignoreIncomingRequestHook: (request) => {
        return request.method === 'GET' && (request.url === '/health' || request.url === '/favicon.ico');
      }
    }
  })
  ];

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
  });

  const sdk = new NodeSDK({
    resource,
    logRecordProcessors: [
      new BatchLogRecordProcessor(new OTLPLogExporter({ url: endpoint, })),
      //new SimpleLogRecordProcessor(new ConsoleLogRecordExporter())
    ],
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint })),
      //new SimpleSpanProcessor(new ConsoleSpanExporter()),
    ],
    instrumentations
  });

  console.log(`OTEL: Starting with service name "${serviceName}", exporting to ${endpoint}`);
  sdk.start();
  console.log('OTEL: Started');

  process.on('SIGTERM', async () => {
    try {
      await sdk.shutdown();
    } catch (error) {
      console.error('Error shutting down OTEL SDK', error);
    }
  });

  return sdk;
}

initializeOTEL();

await waitForAllMessagesAcknowledged();