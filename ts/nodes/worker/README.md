# Beamable.Network Worker Node

A TypeScript-based worker node for the Beamable.Network DePIN (Decentralized Physical Infrastructure Networks) that provides compute infrastructure and earns fees from SLAs.

## Features

- HTTP API server with health checks and worker information endpoints
- Solana blockchain integration via @beamable-network/depin SDK
- Fastify-based web server with Swagger API documentation
- Environment-based configuration with dotenv support
- Docker support for containerized deployment
- Graceful shutdown handling with SIGINT/SIGTERM support
- TypeScript with full type safety
- Structured logging with pino and configurable log levels

## Quick Start

1. **Install dependencies** (from workspace root):
   ```bash
   cd ts && pnpm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Development mode**:
   ```bash
   pnpm run dev
   ```

4. **Production build**:
   ```bash
   pnpm run build
   pnpm start
   ```

## API Endpoints

- `GET /` - Service information and worker details
- `GET /health` - Health check with wallet balance and Solana connection status
- `GET /documentation` - Swagger API documentation interface

## Docker Deployment

```bash
# Build image (from ts/ directory). The Dockerfile uses pnpm deploy
# to produce a minimal, production-only image that includes the
# local workspace dependency (@beamable-network/depin) without publishing.
docker build -f nodes/worker/Dockerfile -t beamable-worker .

# Run container
docker run -p 3000:3000 --env-file nodes/worker/.env beamable-worker
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | `3000` |
| `HOST` | HTTP server host | `0.0.0.0` |
| `NODE_ENV` | Environment mode (`development`, `production`, or `testing`) | `development` |
| `SOLANA_RPC_URL` | Solana RPC endpoint | `http://localhost:8899` |
| `WORKER_PRIVATE_KEY` | JSON array of 64 numbers from solana-keygen grind | *required* |
| `WORKER_LICENSE` | Worker license identifier | *required* |
| `EXTERNAL_URL` | External URL where this worker can be reached | *required* |
| `S3_BUCKET_NAME` | S3 bucket name for storing proofs | *required* |
| `S3_REGION` | S3 bucket region | *required* |
| `S3_ACCESS_KEY_ID` | S3 access key ID (optional if using IAM roles) | *optional* |
| `S3_SECRET_ACCESS_KEY` | S3 secret access key (optional if using IAM roles) | *optional* |
| `LOG_LEVEL` | Logging level (0=trace, 1=trace, 2=debug, 3=info, 4=warn, 5=error, 6=fatal) | `3` (info) |
| `LOG_FORMAT` | Log output format (`pretty` for human-readable, `json` for structured) | `pretty` |

## Logging

The worker uses [pino](https://getpino.io/) for fast, structured logging with context-aware loggers.

### Log Levels

Configure logging verbosity with the `LOG_LEVEL` environment variable:

- `0` (trace) - Everything including trace data
- `1` (trace) - Detailed execution flow
- `2` (debug) - Debug information
- `3` (info) - General information (default)
- `4` (warn) - Warning messages only
- `5` (error) - Error messages only
- `6` (fatal) - Fatal errors only