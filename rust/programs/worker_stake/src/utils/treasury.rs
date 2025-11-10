use depin_core::utils::{tokens::initialize_ata_if_needed, validation::{validate_ata_account, validate_pda_account}};
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    program::invoke_signed,
    pubkey::Pubkey,
};
use spl_token::instruction::transfer_checked;

/// Transfers tokens from a treasury PDA to a user account
///
/// This is a comprehensive helper that:
/// 1. Validates the treasury PDA address
/// 2. Validates the treasury ATA address
/// 3. Initializes the user's ATA if needed
/// 4. Performs the token transfer with PDA signing
///
/// # Arguments
/// * `treasury_pda` - The treasury PDA account
/// * `treasury_ata` - The treasury's ATA (source of tokens)
/// * `user_account` - The user's main account (payer for ATA creation)
/// * `user_token_account` - The user's token account (destination)
/// * `mint_account` - The token mint
/// * `token_program` - SPL Token program
/// * `associated_token_program` - Associated Token program
/// * `system_program` - System program
/// * `program_id` - This program's ID
/// * `worker_collection` - Worker collection address (used in PDA derivation)
/// * `treasury_seed` - The seed used for treasury PDA derivation
/// * `treasury_pda_finder` - Function to find the treasury PDA and bump
/// * `amount` - Amount of tokens to transfer
/// * `decimals` - Token decimals
/// * `token_name` - Human-readable token name for error messages
///
/// # Returns
/// * `Ok(())` if transfer succeeds
/// * `Err(ProgramError)` if any validation or transfer fails
#[allow(clippy::too_many_arguments)]
pub fn transfer_from_treasury<'a, F>(
    treasury_pda: &AccountInfo<'a>,
    treasury_ata: &AccountInfo<'a>,
    user_account: &AccountInfo<'a>,
    user_token_account: &AccountInfo<'a>,
    mint_account: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    associated_token_program: &AccountInfo<'a>,
    system_program: &AccountInfo<'a>,
    program_id: &Pubkey,
    worker_collection: &Pubkey,
    treasury_seed: &[u8],
    treasury_pda_finder: F,
    amount: u64,
    decimals: u8,
    token_name: &str,
) -> ProgramResult
where
    F: FnOnce(&Pubkey, &Pubkey) -> (Pubkey, u8),
{
    // Validate treasury PDA
    let (expected_treasury_pda, treasury_bump) = treasury_pda_finder(program_id, worker_collection);
    validate_pda_account(
        treasury_pda,
        &expected_treasury_pda,
        &format!("{} treasury", token_name),
    )?;

    // Validate treasury ATA
    validate_ata_account(
        treasury_ata,
        treasury_pda.key,
        mint_account.key,
        &format!("{} treasury", token_name),
    )?;

    // Initialize user's token account (ATA) if needed
    initialize_ata_if_needed(
        user_account,
        user_account,
        mint_account,
        user_token_account,
        token_program,
        associated_token_program,
        system_program,
    )?;

    // Transfer tokens from treasury to user
    let transfer_ix = transfer_checked(
        token_program.key,
        treasury_ata.key,
        mint_account.key,
        user_token_account.key,
        treasury_pda.key,
        &[],
        amount,
        decimals,
    )?;

    let signer_seeds = &[
        treasury_seed,
        worker_collection.as_ref(),
        &[treasury_bump],
    ];

    invoke_signed(
        &transfer_ix,
        &[
            treasury_ata.clone(),
            mint_account.clone(),
            user_token_account.clone(),
            treasury_pda.clone(),
            token_program.clone(),
        ],
        &[signer_seeds],
    )?;

    Ok(())
}
