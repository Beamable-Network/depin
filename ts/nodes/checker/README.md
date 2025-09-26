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
| `CHECKER_LICENSE` | Checker license identifier | required |
| `SKIP_BRAND` | Skip BRAND eligibility checks (NOT recommended for production) | `false` |
| `LOG_LEVEL` | Logging level (0–6) | `3` (info) |
| `LOG_FORMAT` | `pretty` or `json` | `pretty` |
