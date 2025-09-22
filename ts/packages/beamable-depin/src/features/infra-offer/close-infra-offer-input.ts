// import type { TransactionSigner } from "gill";
// import { AccountRole } from "gill";

// import { DEPIN_PROGRAM } from "../../constants.js";
// import { DepinInstruction } from "../../enums.js";

// export interface GetCloseInfraOfferInstructionParams {
//   payer: TransactionSigner;
//   offerAccount: TransactionSigner;
// }

// export class CloseInfraOfferInput {
//   constructor() { }

//   serialize(): Uint8Array {
//     // Only the instruction discriminator
//     return Uint8Array.of(DepinInstruction.CloseInfraOffer);
//   }

//   getCloseInfraOfferInstruction(
//     params: GetCloseInfraOfferInstructionParams) {
//     const closeInfraOfferIx = {
//       programAddress: DEPIN_PROGRAM,
//       accounts: [
//         {
//           address: params.payer.address,
//           role: AccountRole.READONLY_SIGNER,
//           signer: params.payer,
//         },
//         { address: params.offerAccount, role: AccountRole.WRITABLE },
//       ] as const,
//       data: this.serialize(),
//     };

//     return closeInfraOfferIx;
//   }
// }
