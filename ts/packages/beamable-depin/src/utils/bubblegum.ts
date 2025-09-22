import { AssetWithProof } from "@metaplex-foundation/mpl-bubblegum";
import { ReadonlyUint8Array, Codec, getStructCodec, getAddressCodec, getU64Codec, getU32Codec, getBytesCodec, getU8Codec, address, Address, getProgramDerivedAddress, getU64Codec as getU64CodecLittleEndian, Endian, getAddressEncoder } from "gill";

// MPL_BUBBLEGUM_PROGRAM_ID
export const MPL_BUBBLEGUM_PROGRAM = address("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");

export interface CNftContext {
    owner: Address;
    delegate: Address;
    nonce: bigint;
    index: number;
    root: ReadonlyUint8Array;
    data_hash: ReadonlyUint8Array;
    creator_hash: ReadonlyUint8Array;
    collection_hash: ReadonlyUint8Array;
    asset_data_hash: ReadonlyUint8Array;
    flags: number;
}

export const CNftContextCodec: Codec<CNftContext> = getStructCodec([
    ["owner", getAddressCodec()],
    ["delegate", getAddressCodec()],
    ["nonce", getU64Codec()],
    ["index", getU32Codec()],
    ["root", getBytesCodec()],
    ["data_hash", getBytesCodec()],
    ["creator_hash", getBytesCodec()],
    ["collection_hash", getBytesCodec()],
    ["asset_data_hash", getBytesCodec()],
    ["flags", getU8Codec()]
]);

export function assetToCNftContext(asset: AssetWithProof): CNftContext {
    return {
        owner: address(asset.leafOwner),
        delegate: address(asset.leafDelegate),
        nonce: BigInt(asset.nonce),
        index: asset.index,
        root: asset.root,
        data_hash: asset.dataHash,
        creator_hash: asset.creatorHash,
        collection_hash: asset.collection_hash,
        asset_data_hash: asset.asset_data_hash,
        flags: asset.flags
    };
}