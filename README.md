# Beamable.Network DePIN

A decentralized physical infrastructure network (DePIN) proof-of-concept for game workloads on Solana.

## Architecture

### Rust (Solana Programs)

#### DePIN Program
- **Location**: `rust/programs/depin/`
- **Purpose**: Core smart contract implementing the DePIN protocol
- **Features**: License management, escrow/SLA handling, BRAND assignment algorithm, proof commitments, reward distribution

#### Worker Stake Program
- **Location**: `rust/programs/bmb_stake_rev_share/`
- **Purpose**: Worker revenue sharing and staking protocol
- **Features**: Dual staking modes (worker self-stake + community pools), time-weighted rewards, optional monthly rev-share pools, triple rewards system (Base USDC + Addon USDC + Base BMB)
- **Documentation**: See [TDD.md](./TDD.md) for detailed technical design

### TypeScript SDK
- **Location**: `ts/packages/beamable-depin/`
- **Purpose**: SDK for network interactions and integration testing
- **NPM Package**: [@beamable-network/depin](https://www.npmjs.com/package/@beamable-network/depin)
- **Workspace**: `ts/` contains all TypeScript packages and tests

## Quick Start

### Prerequisites
- Rust and Cargo
- Node.js and pnpm
- Solana CLI (for testing)

### Build & Test

```bash
# Build Rust program
cd rust && cargo build-sbf

# Install TypeScript dependencies
cd ts && pnpm install

# Build SDK
cd ts/packages/beamable-depin && pnpm run build

# Run tests
cd ts/tests && pnpm test
```