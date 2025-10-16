# Beamable Network Checker Node

## What is a Checker Node?

The Beamable Network Checker Node is a critical component of the Beamable.Network DePIN (Decentralized Physical Infrastructure Network). Checker nodes monitor and verify the performance of worker nodes, generating metrics that contribute to the network's health and reward distribution.

### How It Works

1. **Worker Discovery**: The checker discovers which workers are assigned to it for a particular period (a day)
2. **Performance Monitoring**: The checker periodically monitors those workers, computing performance metrics
3. **Proof Submission**: As the period nears its end, the checker submits signed proofs to the workers
4. **Proof Storage**: Workers store signed proofs from all checkers and make them publicly available
5. **On-Chain Settlement**: When the period ends, workers submit metrics on-chain along with a bitmap of all checkers that sent proofs - this translates to checker activity rewards

**Every license you run will generate network rewards**, which are visible and claimable through the Beamable Network Portal (comming soon).

## Prerequisites

- **Helius API Key**: Required for Solana RPC access. [Get a free tier key](https://www.helius.dev/) - the free tier is sufficient, and default throttling is configured for it.
- **Checker Wallet**: A Solana wallet with a private key (base58 or JSON format)
- **Checker License(s)**: At least one activated checker license NFT

### License Requirements

- Every checker license you own can be run to generate rewards
- Multiple licenses can run in a single checker instance
- Licenses must be **activated** via the Beamable Network Portal (comming soon)
- License activation includes setting a delegate wallet (the wallet that will run the checker)
- If you run the checker with the license owner wallet, licenses will automatically activate and set the delegate to self

### Hardware Requirements

The checker node has minimal hardware requirements:

- **RAM**: At least 256MB RAM recommended
- **CPU**: No specific CPU requirements - any modern CPU will work
- **Network**: Stable internet connection required for continuous operation
- **Storage**: Minimal storage needed (Docker image + logs)

The checker is lightweight and can run on most systems, including:
- Raspberry Pi and similar single-board computers
- VPS instances (even the smallest tiers)
- Home servers or spare hardware
- Cloud compute instances

## Quick Start with Docker

### Single License Example

```bash
docker run -d \
  --name beamable-checker \
  --restart unless-stopped \
  -e SOLANA_NETWORK=mainnet \
  -e HELIUS_API_KEY=your_helius_api_key \
  -e CHECKER_PRIVATE_KEY=your_base58_private_key \
  -e CHECKER_LICENSES=your_license_address \
  beamablenetwork/checker:latest
```

### Multiple Licenses Example

```bash
docker run -d \
  --name beamable-checker \
  --restart unless-stopped \
  -e SOLANA_NETWORK=mainnet \
  -e HELIUS_API_KEY=your_helius_api_key \
  -e CHECKER_PRIVATE_KEY=your_base58_private_key \
  -e CHECKER_LICENSES=license1,license2,license3 \
  beamablenetwork/checker:latest
```

## Docker Compose

Create a `docker-compose.yml` file:

```yaml
services:
  checker:
    image: beamablenetwork/checker:latest
    container_name: beamable-checker
    restart: unless-stopped
    environment:
      SOLANA_NETWORK: mainnet
      HELIUS_API_KEY: ${HELIUS_API_KEY}
      CHECKER_PRIVATE_KEY: ${CHECKER_PRIVATE_KEY}
      CHECKER_LICENSES: ${CHECKER_LICENSES}

      # Optional: Logging configuration
      LOG_LEVEL: info
      LOG_FORMAT: json

      # Optional: Rate limiting (defaults are for free tier)
      # THROTTLE_SEND_TX_LIMIT: 1
      # THROTTLE_SEND_TX_INTERVAL: 1100
      # THROTTLE_GET_ACCOUNTS_LIMIT: 5
      # THROTTLE_GET_ACCOUNTS_INTERVAL: 1100
      # THROTTLE_GET_ASSET_LIMIT: 1
      # THROTTLE_GET_ASSET_INTERVAL: 600
      # THROTTLE_GET_ACCOUNT_LIMIT: 8
      # THROTTLE_GET_ACCOUNT_INTERVAL: 1100
```

Create a `.env` file with your secrets:

```bash
HELIUS_API_KEY=your_helius_api_key_here
CHECKER_PRIVATE_KEY=your_base58_private_key_here
CHECKER_LICENSES=license1,license2,license3
```

Then run:

```bash
docker-compose up -d
```

## Configuration Options

### Required Configuration

| Variable | Description | Example |
|----------|-------------|---------|
| `SOLANA_NETWORK` | Solana network to connect to | `mainnet` or `devnet` |
| `HELIUS_API_KEY` | Your Helius API key for RPC access | `abc123...` |
| `CHECKER_PRIVATE_KEY` | Checker wallet private key (base58 or JSON array format) | `5J7w8...` or `[1,2,3,...,64]` |
| `CHECKER_LICENSES` | Comma-separated list of license addresses to run | `license1,license2,license3` |

### Optional Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `SKIP_BRAND` | Skip BRAND eligibility checks (for testing only) | `false` |
| `LOG_LEVEL` | Logging verbosity: `trace`, `debug`, `info`, `warn`, `error`, `fatal` | `info` |
| `LOG_FORMAT` | Output format: `pretty` (colored, human-readable) or `json` (structured) | `pretty` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry GRPC endpoint for logs and traces | (disabled) |

### Rate Limiting / Throttle Configuration

These settings control RPC request rates to comply with Helius API limits. **The defaults are configured for the free tier**.

| Variable | Description | Default |
|----------|-------------|---------|
| `THROTTLE_SEND_TX_LIMIT` | Max transaction sends per interval | `1` |
| `THROTTLE_SEND_TX_INTERVAL` | Interval window in milliseconds | `1100` |
| `THROTTLE_GET_ACCOUNTS_LIMIT` | Max `getProgramAccounts` calls per interval | `5` |
| `THROTTLE_GET_ACCOUNTS_INTERVAL` | Interval window in milliseconds | `1100` |
| `THROTTLE_GET_ASSET_LIMIT` | Max asset metadata fetches per interval | `1` |
| `THROTTLE_GET_ASSET_INTERVAL` | Interval window in milliseconds | `600` |
| `THROTTLE_GET_ACCOUNT_LIMIT` | Max `getAccount` calls per interval | `8` |
| `THROTTLE_GET_ACCOUNT_INTERVAL` | Interval window in milliseconds | `1100` |

## Private Key Formats

The checker supports two private key formats:

### Base58 Format (Recommended)
```bash
CHECKER_PRIVATE_KEY=5J7w8d3K9mP2q4R6t8V1x3Z5b7N9j1M3p5S7u9W1y3A5c7E9g1I3k5M7o9Q1s3
```

### JSON Array Format (from `solana-keygen`)
```bash
CHECKER_PRIVATE_KEY=[1,2,3,4,5,...,64]
```

## Managing Multiple Licenses

You can run a checker for multiple licenses in several ways:

### Option 1: Single Instance with Multiple Licenses (Recommended)
Run one checker instance with multiple licenses specified:
```bash
CHECKER_LICENSES=license1,license2,license3
```

### Option 2: Multiple Separate Instances
Run separate checker instances for each license (requires more resources):
```bash
# Instance 1
docker run -d --name checker1 -e CHECKER_LICENSES=license1 ...

# Instance 2
docker run -d --name checker2 -e CHECKER_LICENSES=license2 ...
```

## Important Notes

### Keep Your Checker Updated

**Always keep your checker image up-to-date** to ensure you have the latest improvements and bug fixes:

```bash
# Pull the latest image
docker pull beamablenetwork/checker:latest

# Restart your container
docker-compose down
docker-compose up -d
```

**Not keeping your checker updated may negatively impact your network rewards.**

### Version Pinning

For production deployments, consider pinning to specific versions:

```yaml
services:
  checker:
    image: beamablenetwork/checker:v1.2.3  # Pin to specific version
```

Check available versions on [Docker Hub](https://hub.docker.com/r/beamablenetwork/checker).

## Monitoring Your Checker

### View Logs

```bash
# Docker
docker logs -f beamable-checker

# Docker Compose
docker-compose logs -f checker
```

### Check Status

```bash
# Check if container is running
docker ps | grep beamable-checker

# Check container health
docker inspect beamable-checker
```

### Claim Rewards

View and claim your checker rewards at the Beamable Network Portal (comming soon).

## Troubleshooting

### Checker Won't Start

- Verify your `HELIUS_API_KEY` is valid
- Ensure `CHECKER_PRIVATE_KEY` is in the correct format (base58 or JSON array)
- Check that `SOLANA_NETWORK` is either `mainnet` or `devnet`
- Review logs for specific error messages: `docker logs beamable-checker`

### Rate Limiting Errors

If you're hitting rate limits, adjust throttle settings or upgrade your Helius plan:

```bash
# Example: Increase limits for paid Helius tier
THROTTLE_SEND_TX_LIMIT=10
THROTTLE_GET_ACCOUNTS_LIMIT=20
```

### License Not Found

If the checker can't find your license:
1. Verify the license is activated in the Beamable Network Portal (comming soon)
2. Ensure the license delegate is set to your checker wallet
3. Check the license address is correct
4. Wait a few minutes for on-chain state to propagate

## Support

For issues, questions, or feature requests:
- Visit the Beamable Network Portal (comming soon)
- Join the community Discord
- Open an issue on GitHub
