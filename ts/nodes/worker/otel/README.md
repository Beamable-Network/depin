# OpenTelemetry Setup

This application includes optional OpenTelemetry (OTEL) instrumentation for traces and logs.

## Features

- **Auto-instrumentation** for Fastify, Pino, HTTP, and other Node.js libraries
- **Optional configuration** - app runs normally without OTEL
- **Traces** exported to OTLP collector
- **Logs** exported via Pino instrumentation

## Configuration

OTEL is completely optional. If the environment variables are not set, the app runs normally.

### Required Environment Variable

Add to your `.env` file:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

## Local Testing with Docker

### 1. Start the OTEL Collector and Jaeger UI

From the project root:

```bash
docker compose -f otel/docker-compose.yaml up -d
```

This starts:
- **OTEL Collector** on port 4318 (HTTP endpoint for receiving traces/logs)
- **Jaeger UI** on port 16686 for viewing traces

### 2. Configure Your Application

Add to your `.env` file:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

### 3. Start Your Application

```bash
pnpm start
```

### 4. View Traces in Jaeger

Open your browser to:
```
http://localhost:16686
```

Select service `@beamable/depin-worker` and click "Find Traces" to see your application traces.

### 5. View Logs in Collector

Check the OTEL collector logs to see exported logs:

```bash
docker logs otel-collector -f
```

## Stopping the Collector

```bash
docker compose -f otel/docker-compose.yaml down
```

To also remove volumes:

```bash
docker compose -f otel/docker-compose.yaml down -v
```

## Implementation Details

- OTEL is initialized in `src/otel.ts`
- Must be loaded **before** other imports in `src/index.ts` for auto-instrumentation to work
- Service name is read from `package.json`
- File system instrumentation is disabled to reduce noise
- Pino, Fastify, and HTTP instrumentations are enabled

## Troubleshooting

### App runs but no traces appear

1. Verify OTEL collector is running: `docker ps | grep otel-collector`
2. Check collector logs: `docker logs otel-collector`
3. Ensure `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly in `.env`

### App won't start

If OTEL prevents the app from starting, simply remove or comment out the `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable. The app will run normally without OTEL.
