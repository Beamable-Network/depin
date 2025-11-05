import { AssetWithProof } from "@metaplex-foundation/mpl-bubblegum";
import { ReadonlyUint8Array, Codec, getStructCodec, getAddressCodec, getU64Codec, getU32Codec, getBytesCodec, getU8Codec, address, Address, getProgramDerivedAddress, getU64Codec as getU64CodecLittleEndian, Endian, getAddressEncoder, Option, isSome, some, none, getOptionCodec, fixCodecSize } from "gill";

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
    collection: Option<Address>;
    asset_data_hash: ReadonlyUint8Array;
    flags: number;
}

export const CNftContextCodec: Codec<CNftContext> = getStructCodec([
    ["owner", getAddressCodec()],
    ["delegate", getAddressCodec()],
    ["nonce", getU64Codec()],
    ["index", getU32Codec()],
    ["root", fixCodecSize(getBytesCodec(), 32)],
    ["data_hash", fixCodecSize(getBytesCodec(), 32)],
    ["creator_hash", fixCodecSize(getBytesCodec(), 32)],
    ["collection", getOptionCodec(getAddressCodec())],
    ["asset_data_hash", fixCodecSize(getBytesCodec(), 32)],
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
        collection: isSome(asset.metadata.collection) ? some(address(asset.metadata.collection.value.key)) : none(),
        asset_data_hash: asset.asset_data_hash,
        flags: asset.flags
    };
}