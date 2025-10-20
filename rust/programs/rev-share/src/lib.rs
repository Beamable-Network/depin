use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, pubkey::Pubkey,
    declare_id,
};

declare_id!("BREVZXgDcNah3xeJ8s3FHZmg8WmybywFZkr3XE7i9cBf");

mod instruction;
pub mod instructions;
pub mod shared;
mod processor;

entrypoint!(process_instruction);

fn process_instruction<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    instruction_data: &[u8],
) -> ProgramResult {
    processor::process(program_id, accounts, instruction_data)
}
