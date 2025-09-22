// import { Address, getAddressEncoder, getProgramDerivedAddress, ProgramDerivedAddress } from 'gill';
// import { ESCROW_SEED, TOKEN_SEED, DEPIN_PROGRAM } from '../../constants.js';

// const addressEncoder = getAddressEncoder();

// export async function findEscrowPDA(payer: Address, mint: Address): Promise<ProgramDerivedAddress> {
//     const pda = await getProgramDerivedAddress({
//         programAddress: DEPIN_PROGRAM,
//         seeds: [ESCROW_SEED, TOKEN_SEED, addressEncoder.encode(payer), addressEncoder.encode(mint)]
//     });
//     return pda;
// }