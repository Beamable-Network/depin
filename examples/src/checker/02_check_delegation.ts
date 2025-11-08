import { CheckerMetadataAccount } from '@beamable-network/depin';
import { publicKey } from '@metaplex-foundation/umi';
import { isAddress } from 'gill';

import { createClient } from '../client';
import { askForInput } from '../utils';

// Initialize Solana client
const client = await createClient('devnet');

// Get checker license address from user
const licenseAddress = await askForInput("Enter checker license");
if (!isAddress(licenseAddress)) {
    throw new Error("Invalid license address");
}

// Get license owner address from user
const licenseOwner = await askForInput("Enter license owner address");
if (!isAddress(licenseOwner)) {
    throw new Error("Invalid license owner address");
}

const pda = await CheckerMetadataAccount.findCheckerMetadataPDA(licenseAddress, licenseOwner);
const info = await client.rpcClient.rpc.getAccountInfo(publicKey(pda[0])).send();
if (!info.value) {
    throw new Error("Checker metadata not found, license not activated or not a valid license");
}

const checkerMetadata = CheckerMetadataAccount.deserializeFrom(info.value.data);
console.log("Checker license is activated and delegated to:", checkerMetadata.delegatedTo);