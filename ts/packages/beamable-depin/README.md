# @beamable-network/depin

TypeScript SDK for interacting with Beamable's decentralized physical infrastructure network (DePIN) on Solana.

## Installation

```bash
npm install @beamable-network/depin
```

## Features

- **DePIN Protocol**: License management, escrow/SLA handling, BRAND assignment, proof commitments, and reward distribution
- **Worker Staking**: Revenue sharing and staking protocol with dual staking modes and time-weighted rewards
- **Modern Solana Development**: Built with [gill](https://www.npmjs.com/package/gill) and [@solana/kit](https://www.npmjs.com/package/@solana/kit) packages
- **Type-Safe**: Full TypeScript support with comprehensive type definitions

## Quick Start

This SDK is compatible with `gill` and `@solana/kit` packages (not the legacy `@solana/web3.js`).

### Basic Example: Claim Checker Rewards

```typescript
import { PayoutCheckerRewards, CheckerRewardsVault } from '@beamable-network/depin';
import { Address } from 'gill';

// Create the instruction
const payout = new PayoutCheckerRewards({
    signer: checkerOwner.address,
    checker_license: checkerLicense,
});

// Get the vault
const cfg = await CheckerRewardsVault.readFromState(async (addr) => {
    // Your implementation to fetch account data
    return await fetchAccountData(addr);
});

// Build and send transaction
const transaction = await client
    .buildTransaction()
    .addInstruction(await payout.getInstruction(cfg))
    .sendTransaction({ payer: checkerOwner });
```

### Utilities
- `bmbToBaseUnits(amount)`: Convert BMB to base units (lamports)
- `getCurrentPeriod()`: Get current day period
- `getMonthFromPeriod(period)`: Convert day period to month period

## Documentation

- **GitHub Repository**: [github.com/Beamable-Network/depin](https://github.com/Beamable-Network/depin)
- **DePIN Documentation**: [docs.beamable.network](https://docs.beamable.network/)

## Compatibility

This SDK uses modern Solana development libraries:
- **gill** - Modern Solana RPC client
- **@solana/kit** - Official Solana program utilities

**Note**: This SDK is **not** compatible with the legacy `@solana/web3.js` package. Use `gill` or `@solana/kit` for transaction building and signing.

## Links

- [NPM Package](https://www.npmjs.com/package/@beamable-network/depin)
- [GitHub Repository](https://github.com/Beamable-Network/depin)
- [Changelog](https://github.com/Beamable-Network/depin/blob/main/ts/packages/beamable-depin/CHANGELOG.md)
- [Beamable Network](https://beamable.network/)
- [Report Issues](https://github.com/Beamable-Network/depin/issues)
