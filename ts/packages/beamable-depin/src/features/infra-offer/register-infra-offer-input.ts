// import {
//     AccountRole,
//     addCodecSizePrefix,
//     Codec,
//     getStructCodec,
//     getU32Codec,
//     getU64Codec,
//     getUtf8Codec,
//     type TransactionSigner
// } from "gill";

// import { DEPIN_PROGRAM } from "../../constants.js";
// import { DepinInstruction } from "../../enums.js";

// export interface RegisterInfraOfferParams {
//     name: string;
//     description: string;
//     cpu: bigint;
//     memory: bigint;
//     price: bigint;
// }

// export interface GetRegisterOfferInstructionParams {
//     payer: TransactionSigner;
//     offerAccount: TransactionSigner;
// }

// export const RegisterInfraOfferParamsCodec: Codec<RegisterInfraOfferParams> = getStructCodec([
//     ["cpu", getU64Codec()],
//     ["memory", getU64Codec()],
//     ["price", getU64Codec()],
//     ["name", addCodecSizePrefix(getUtf8Codec(), getU32Codec())],
//     ["description", addCodecSizePrefix(getUtf8Codec(), getU32Codec())],
// ]);

// export class RegisterInfraOfferInput {
//     readonly name: string;
//     readonly description: string;
//     readonly cpu: bigint;
//     readonly memory: bigint;
//     readonly price: bigint;

//     constructor(params: RegisterInfraOfferParams) {
//         this.name = params.name;
//         this.description = params.description;
//         this.cpu = params.cpu;
//         this.memory = params.memory;
//         this.price = params.price;
//     }
    
//     private serialize(): Uint8Array {
//         const inner = RegisterInfraOfferParamsCodec.encode(this);
//         return Uint8Array.of(DepinInstruction.RegisterInfraOffer, ...inner);
//     }    

//     public getRegisterOfferInstruction(params: GetRegisterOfferInstructionParams) {
//         return {
//             programAddress: DEPIN_PROGRAM,
//             accounts: [
//                 { address: params.payer.address, role: AccountRole.READONLY_SIGNER },
//                 { address: params.offerAccount.address, role: AccountRole.WRITABLE },
//             ],
//             data: this.serialize(),
//         };
//     }
// }
