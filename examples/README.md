# Beamable.Network DePIN Examples

This folder contains example scripts demonstrating how to use the `@beamable-network/depin` package to interact with Beamable.Network's decentralized infrastructure.

## Running Examples

All examples require a Solana secret key for signing transactions. They will prompt you to enter:
- Your secret key as a JSON array (e.g., `[1,2,3,...]`)
- License address when needed

Run using tsx:
```bash
pnpm tsx checker/01_delegate.ts
```

## Setup

```bash
pnpm install
```

The examples connect to Solana mainnet by default and use the `@beamable-network/depin` SDK to interact with the on-chain program.

## Web Integration

These examples can be adapted for web applications. Replace the console-based input methods with browser wallet integrations:

- Remove `askForSecretKey()` and `askForInput()` from `utils.ts`
- Use a Solana wallet adapter (e.g., `@solana/wallet-adapter-react`) to get the user's public key and signer
- Replace `createClient()` logic to use wallet connection instead of stdin secret key input

We'using @solana/kit (gill) for blockchain interactions so make sure you use approprate packages. See: https://www.npmjs.com/package/@solana/react

NOTE: We're also using UMI framework because Bubblegum's SDKs use UMI, but only for read operations.