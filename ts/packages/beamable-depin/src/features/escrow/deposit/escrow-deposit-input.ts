// import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
// import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
// import { AccountRole, Address, Codec, getStructCodec, getU64Codec, TransactionSigner } from 'gill';

// import { DEPIN_PROGRAM } from '../../../constants.js';
// import { DepinInstruction } from '../../../enums.js';

// export interface EscrowDepositParams {
//     amount: bigint;
// }

// export interface GetEscrowDepositInstructionParams {
//     provider: TransactionSigner;
//     associatedUsdcAccount: Address;
//     escrowTokenAccount: Address;
//     usdcMint: Address;
// }

// export const EscrowDepositParamsCodec: Codec<EscrowDepositParams> = getStructCodec([
//     ["amount", getU64Codec()]
// ]);

// export class EscrowDepositInput {
//     readonly amount: bigint;

//     constructor(params: EscrowDepositParams) {
//         this.amount = params.amount;
//     }

//     private serialize(): Uint8Array {
//         const inner = EscrowDepositParamsCodec.encode(this);
//         return Uint8Array.of(DepinInstruction.EscrowDeposit, ...inner);
//     }

//     public getEscrowDepositInstruction(params: GetEscrowDepositInstructionParams) {
//         return {
//             programAddress: DEPIN_PROGRAM,
//             accounts: [
//                 { address: params.provider.address, role: AccountRole.READONLY_SIGNER },
//                 { address: params.associatedUsdcAccount, role: AccountRole.WRITABLE },
//                 { address: params.escrowTokenAccount, role: AccountRole.WRITABLE },
//                 { address: params.usdcMint, role: AccountRole.READONLY },
//                 { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
//                 { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
//             ],
//             data: this.serialize(),
//         };
//     }
// }