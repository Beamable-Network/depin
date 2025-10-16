use solana_program::{account_info::AccountInfo, declare_id, entrypoint, entrypoint::ProgramResult, pubkey::Pubkey };

mod instruction;
pub mod instructions;
pub mod shared;
mod processor;

declare_id!("BMBpXq5RaoRf5pGsQpuwjcozaLF2TuNCmYKKcFJjFiFS");

entrypoint!(process_instruction);

fn process_instruction<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    instruction_data: &[u8],
) -> ProgramResult {
    processor::process(program_id, accounts, instruction_data)
}
