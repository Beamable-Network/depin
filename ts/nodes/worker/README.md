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
| `HELIUS_API_KEY` | Helius API key for Solana RPC access ([Get a free tier key](https://www.helius.dev/)) | required |
| `SOLANA_NETWORK` | 'devnet' or 'mainnet' | required |
| `WORKER_PRIVATE_KEY` | Full private key in base58 OR JSON array of 64 numbers from solana-keygen | *required* |
| `WORKER_LICENSE` | Worker license identifier | *required* |
| `EXTERNAL_URL` | External URL where this worker can be reached | *required* |
| `S3_BUCKET_NAME` | S3 bucket name for storing proofs | *required* |
| `S3_BUCKET_PATH` | S3 bucket path prefix for storing proofs | `` (root) |
| `S3_REGION` | S3 bucket region | *required* |
| `S3_ACCESS_KEY_ID` | S3 access key ID (optional if using IAM roles) | *optional* |
| `S3_SECRET_ACCESS_KEY` | S3 secret access key (optional if using IAM roles) | *optional* |
| `LOG_LEVEL` | Logging level ("trace", "debug", "info", "warn", "error", "fatal") | `info` |
| `LOG_FORMAT` | Log output format (`pretty` for human-readable, `json` for structured) | `pretty` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTEL GRPC endpoint | *optional* |
| `THROTTLE_SEND_TX_LIMIT` | Max transaction submissions per interval | `1` |
| `THROTTLE_SEND_TX_INTERVAL` | Transaction submission interval (ms) | `1100` |
| `THROTTLE_SEARCH_ASSETS_LIMIT` | Max searchAssets calls per interval | `5` |
| `THROTTLE_SEARCH_ASSETS_INTERVAL` | searchAssets call interval (ms) | `1100` |
