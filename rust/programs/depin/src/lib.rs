use solana_program::{account_info::AccountInfo, declare_id, entrypoint, entrypoint::ProgramResult, pubkey::Pubkey };

mod processor;
mod instruction;

declare_id!("bmb3KBHjzHzH7ZJ1aNG1v2XpciuX9g89TyRYK7sJXec");

entrypoint!(process_instruction);

fn process_instruction<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    instruction_data: &[u8],
) -> ProgramResult {
    processor::process(program_id, accounts, instruction_data)
}