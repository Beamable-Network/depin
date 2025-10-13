# Beamable.Network Checker Node

A TypeScript-based checker node for the Beamable.Network DePIN that verifies worker performance and (in the future) submits proofs.

## Features

- Headless process (no HTTP server) with background service loop
- Solana integration via `@beamable-network/depin` and Umi
- Environment-based configuration with dotenv support
- Docker support for containerized deployment
- Graceful shutdown handling
- Structured logging with pino (pretty or JSON)

## Quick Start

1. Install dependencies (from workspace root):
   ```bash
   cd ts && pnpm install
   ```

2. Configure environment:
   ```bash
   cp nodes/checker/.env.example nodes/checker/.env
   # Edit .env with your configuration
   ```

3. Development:
   ```bash
   cd nodes/checker
   pnpm dev
   ```

4. Production build:
   ```bash
   pnpm build
   pnpm start
   ```

## Docker

```bash
# Build image (from ts/ directory)
docker build -f nodes/checker/Dockerfile -t beamable-checker .

# Run container
docker run --env-file nodes/checker/.env beamable-checker
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SOLANA_NETWORK` | Solana network (`mainnet` or `devnet`) | required |
| `HELIUS_API_KEY` | Helius API key for Solana RPC access | required |
| `CHECKER_PRIVATE_KEY` | JSON array of 64 numbers from solana-keygen grind | required |
| `CHECKER_LICENSES` | Comma-separated list of checker license addresses | optional |
| `SKIP_BRAND` | Skip BRAND eligibility checks (NOT recommended for production) | `false` |
| `LOG_LEVEL` | Logging level ("trace", "debug", "info", "warn", "error", "fatal") | `info` |
| `LOG_FORMAT` | `pretty` or `json` | `pretty` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTEL GRPC endpoint | optional |

### Rate Limiting / Throttle Configuration (Optional)

These settings control how often RPC operations are made to respect rate limits. All have sensible defaults.

| Variable | Description | Default |
|----------|-------------|---------|
| `THROTTLE_SEND_TX_LIMIT` | Max concurrent transaction sends | `1` |
| `THROTTLE_SEND_TX_INTERVAL` | Minimum milliseconds between transaction sends | `1100` |
| `THROTTLE_GET_ACCOUNTS_LIMIT` | Max concurrent getProgramAccounts calls | `5` |
| `THROTTLE_GET_ACCOUNTS_INTERVAL` | Minimum milliseconds between getProgramAccounts calls | `1100` |
| `THROTTLE_GET_ASSET_LIMIT` | Max concurrent asset metadata fetches | `1` |
| `THROTTLE_GET_ASSET_INTERVAL` | Minimum milliseconds between asset fetches | `600` |
| `THROTTLE_GET_ACCOUNT_LIMIT` | Max concurrent getAccount calls | `8` |
| `THROTTLE_GET_ACCOUNT_INTERVAL` | Minimum milliseconds between getAccount calls | `1100` |

**Note:** The checker node supports running multiple licenses simultaneously. Each license will run as an independent checker instance using the same wallet (`CHECKER_PRIVATE_KEY`). Simply provide multiple license addresses separated by commas in `CHECKER_LICENSES`. If you don't provide a license, the checker will fetch all active licenses that are delegated to this checker and use them.
