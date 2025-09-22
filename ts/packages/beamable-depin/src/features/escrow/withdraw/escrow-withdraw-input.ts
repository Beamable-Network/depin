// import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
// import { AccountRole, Address, Codec, getStructCodec, getU64Codec, TransactionSigner } from 'gill';

// import { DEPIN_PROGRAM } from '../../../constants.js';
// import { DepinInstruction } from '../../../enums.js';

// export interface EscrowWithdrawParams {
//     amount: bigint;
// }

// export interface GetEscrowWithdrawInstructionParams {
//     payer: TransactionSigner;
//     associatedUsdcAccount: Address;
//     escrowTokenAccount: Address;
// }

// export const EscrowWithdrawParamsCodec: Codec<EscrowWithdrawParams> = getStructCodec([
//     ["amount", getU64Codec()]
// ]);

// export class EscrowWithdrawInput {
//     readonly amount: bigint;

//     constructor(params: EscrowWithdrawParams) {
//         this.amount = params.amount;
//     }

//     private serialize(): Uint8Array {
//         const inner = EscrowWithdrawParamsCodec.encode(this);
//         return Uint8Array.of(DepinInstruction.EscrowWithdrawl, ...inner);
//     }

//     public getEscrowWithdrawInstruction(params: GetEscrowWithdrawInstructionParams) {
//         return {
//             programAddress: DEPIN_PROGRAM,
//             accounts: [
//                 { address: params.payer.address, role: AccountRole.READONLY_SIGNER },
//                 { address: params.associatedUsdcAccount, role: AccountRole.WRITABLE },
//                 { address: params.escrowTokenAccount, role: AccountRole.WRITABLE },
//                 { address: DEPIN_PROGRAM, role: AccountRole.READONLY },
//                 { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
//             ],
//             data: this.serialize(),
//         };
//     }
// }