use solana_program::{account_info::AccountInfo, declare_id, entrypoint, entrypoint::ProgramResult, pubkey::Pubkey };

mod processor;
mod instruction;

declare_id!("bmbpe9Ddo4oF8HuQFN4XYXLNwzBiwh2fRmA3te9b7LG");

entrypoint!(process_instruction);

fn process_instruction<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    instruction_data: &[u8],
) -> ProgramResult {
    processor::process(program_id, accounts, instruction_data)
}