# CLAUDE.md

## Project Overview

This is a Beamable.Network DePIN (Decentralized Physical Infrastructure Networks) proof-of-concept implementing a decentralized network for game workloads. The system connects three actors: Workers (infrastructure providers), Checkers (independent verifiers), and End Users (game studios/consumers).

## Architecture

### Rust (Solana Program)
- **Location**: `rust/programs/depin/`
- **Purpose**: Core Solana smart contract implementing the DePIN protocol
- **Key Features**: License management, escrow/SLA handling, BRAND assignment algorithm, proof commitments, reward distribution
- **Build**: `cd rust && cargo build`

### TypeScript SDK & Testing
- **Workspace**: `ts/` - pnpm workspace containing all TypeScript packages
- **Main Package**: `ts/packages/beamable-depin/` - @beamable-network/depin SDK for all network interactions
- **Utilities**: `ts/packages/b58-convert/` - Base58 conversion tools
- **Testing**: `ts/tests/` - Integration tests for Rust program + TypeScript SDK (references @beamable-network/depin via workspace)
- **Build**: `cd ts/packages/beamable-depin && pnpm run build`
- **Test**: `cd ts/tests && pnpm test` (requires local Solana validator)

## Key Concepts

- **BRAND Algorithm**: Deterministic assignment of 512 checkers per worker per period
- **Periods**: Daily cycles starting 2025-06-01, aligning all network operations
- **Licensing**: Compressed NFTs (cNFTs) via Bubblegum for worker/checker participation
- **SLAs**: On-chain service agreements with escrow-backed payments
- **Proofs**: Checker performance measurements aggregated into Merkle trees

## Development Commands

```bash
# Rust development
cd rust && cargo build
cd rust && cargo build --release

# TypeScript development  
cd ts && pnpm install
cd ts/packages/beamable-depin && pnpm run build

# Testing
cd ts/tests && pnpm test
```

## Network Actors

- **Workers**: Provide compute infrastructure, earn fees from SLAs
- **Checkers**: Verify worker performance, earn $BMB token rewards  
- **End Users**: Consume infrastructure via escrow-backed contracts