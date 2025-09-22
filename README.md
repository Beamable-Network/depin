# Beamable.Network DePIN

A decentralized physical infrastructure network (DePIN) proof-of-concept for game workloads on Solana.

## Architecture

### Rust (Solana Program)
- **Location**: `rust/programs/depin/`
- **Purpose**: Core smart contract implementing the DePIN protocol
- **Features**: License management, escrow/SLA handling, BRAND assignment algorithm, proof commitments, reward distribution

### TypeScript SDK
- **Location**: `ts/packages/beamable-depin/`
- **Purpose**: SDK for network interactions and integration testing
- **Workspace**: `ts/` contains all TypeScript packages and tests

## Quick Start

### Prerequisites
- Rust and Cargo
- Node.js and pnpm
- Solana CLI (for testing)

### Build & Test

```bash
# Build Rust program
cd rust && cargo build

# Install TypeScript dependencies
cd ts && pnpm install

# Build SDK
cd ts/packages/beamable-depin && pnpm run build

# Run tests (requires local Solana validator)
cd ts/tests && pnpm test
```