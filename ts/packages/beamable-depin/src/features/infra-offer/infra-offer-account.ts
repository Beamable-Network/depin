// import { addCodecSizePrefix, Address, Base58EncodedBytes, Codec, getAddressCodec, getBase58Codec, getBooleanCodec, getStructCodec, getU32Codec, getU64Codec, getUtf8Codec } from 'gill';
// import { DepinAccountType } from './../../enums.js';
// import { RegisterInfraOfferInput } from './register-infra-offer-input.js';

// export class InfraOfferAccount {
//     provider: Address;
//     name: string;
//     description: string;
//     cpu: bigint;
//     memory: bigint;
//     price: bigint;
//     is_active: boolean;

//     constructor(fields: { provider: Address; name: string; description: string; cpu: bigint; memory: bigint; price: bigint; is_active: boolean; }) {
//         this.provider = fields.provider;
//         this.name = fields.name;
//         this.description = fields.description;
//         this.cpu = fields.cpu;
//         this.memory = fields.memory;
//         this.price = fields.price;
//         this.is_active = fields.is_active;
//     }

//     public static calculateAccountSize(input: RegisterInfraOfferInput): bigint {
//         const utf8EncodedName = Buffer.from(input.name, 'utf8');
//         const utf8EncodedDescription = Buffer.from(input.description, 'utf8');
//         return BigInt(
//             1 + // discriminator
//             32 + // provider (address)
//             8 + // cpu (u64)
//             8 + // memory (u64)
//             8 + // price (u64)
//             1 + // is_active (u8)
//             4 + utf8EncodedName.length + // name (string with length prefix)
//             4 + utf8EncodedDescription.length // description (string with length prefix)
//         );
//     }

//     public static readonly DataCodec: Codec<InfraOfferAccount> = getStructCodec([
//         ["provider", getAddressCodec()],
//         ["cpu", getU64Codec()],
//         ["memory", getU64Codec()],
//         ["price", getU64Codec()],
//         ["is_active", getBooleanCodec()],
//         ["name", addCodecSizePrefix(getUtf8Codec(), getU32Codec())],
//         ["description", addCodecSizePrefix(getUtf8Codec(), getU32Codec())],
//     ]);

//     public static deserializeFrom(accountData: ArrayLike<number>): InfraOfferAccount;
//     public static deserializeFrom(accountDataBase58: Base58EncodedBytes): InfraOfferAccount;
//     public static deserializeFrom(accountData: ArrayLike<number> | Base58EncodedBytes): InfraOfferAccount {
//         let accountDataBuffer: ArrayLike<number>;
    
//         if (typeof accountData === 'string') {
//             accountDataBuffer = getBase58Codec().encode(accountData);
//         } else {
//             accountDataBuffer = accountData;
//         }
    
//         const accountDiscriminator = accountDataBuffer[0];
//         if (accountDiscriminator !== DepinAccountType.InfraOffer) {
//             throw new Error(`Invalid discriminator: ${accountDiscriminator}`);
//         }
    
//         const data = Buffer.from(accountDataBuffer).subarray(1); // Skip the first byte (discriminator)
//         const result = this.DataCodec.decode(data);
//         return result;
//     }
// }