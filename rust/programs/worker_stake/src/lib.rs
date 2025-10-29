use solana_program::{account_info::AccountInfo, declare_id, entrypoint, entrypoint::ProgramResult, pubkey::Pubkey};

mod instruction;
pub mod instructions;
pub mod state;
pub mod types;
pub mod utils;
mod processor;

declare_id!("WSTKhDg9nQ8h2ZmnmNdR6heSGU6uYJSwdUNpzSYXBSe");

entrypoint!(process_instruction);

fn process_instruction<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    instruction_data: &[u8],
) -> ProgramResult {
    processor::process(program_id, accounts, instruction_data)
}
