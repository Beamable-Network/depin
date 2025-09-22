import { Address, Base58EncodedBytes, getAddressEncoder, getBase58Codec, GetProgramAccountsMemcmpFilter, getU8Codec, ReadonlyUint8Array } from "gill";
import { DepinAccountType } from "../enums.js";

function toBase58EncodedBytes(data: ReadonlyUint8Array): Base58EncodedBytes {
    return getBase58Codec().decode(new Uint8Array(data)) as Base58EncodedBytes;
}

export function addressToBase58EncodedBytes(address: Address): Base58EncodedBytes {
    const addressBytes = getAddressEncoder().encode(address);
    return toBase58EncodedBytes(addressBytes);
}

export function optionNoneToBase58EncodedBytes(): Base58EncodedBytes {
    return toBase58EncodedBytes(new Uint8Array([0]));
}

export function getDepinAccountFilter(accountType: DepinAccountType): GetProgramAccountsMemcmpFilter {
    const accountTypeBytes = getU8Codec().encode(accountType);
    return {
        memcmp: {
            bytes: toBase58EncodedBytes(accountTypeBytes),
            encoding: 'base58',
            offset: 0n,
        }
    };
};