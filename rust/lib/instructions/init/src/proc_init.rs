use shared::constants::seeds::{GLOBAL_REWARDS_SEED, GLOBAL_SEED, TREASURY_SEED, STATE_SEED};
use shared::features::rewards::accounts::GlobalRewards;
use shared::features::treasury::accounts::{TreasuryState, TreasuryConfig};
use shared::types::account::DepinAccountType;
use shared::utils::account::write_account_data;
use solana_program::program::invoke_signed;
use solana_program::rent::Rent;
use solana_program::{system_instruction};
use solana_program::sysvar::Sysvar;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

pub fn process_init_network(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Caller
    // 1. [writable] GlobalRewards PDA
    // 2. [writable] TreasuryState PDA
    // 3. [writable] TreasuryConfig PDA
    // 4. [] System program account (for account creation)
    let account_info_iter = &mut accounts.iter();
    let caller_account = next_account_info(account_info_iter)?;
    let global_rewards_account = next_account_info(account_info_iter)?;
    let treasury_state_account = next_account_info(account_info_iter)?;
    let treasury_config_account = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    if !caller_account.is_signer {
        msg!("Error: Caller must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    init_global_rewards(program_id, caller_account, global_rewards_account, system_program)?;
    init_treasury_state(program_id, caller_account, treasury_state_account, system_program)?;
    init_treasury_config(program_id, caller_account, treasury_config_account, system_program)?;
    Ok(())
}

fn init_global_rewards<'a>(
    program_id: &Pubkey,
    payer_account: &AccountInfo<'a>,
    global_rewards_account: &AccountInfo<'a>,
    system_program: &AccountInfo<'a>
) -> ProgramResult {
    let (pda, bump_seed) = GlobalRewards::find_pda(program_id);

    if *global_rewards_account.key != pda {
        msg!("Error: GlobalRewards account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    if !global_rewards_account.is_writable {
        msg!("Error: GlobalRewards account must be writable");
        return Err(ProgramError::InvalidArgument);
    }

    // Step 1: Create account if it doesn't exist
    if global_rewards_account.data_is_empty() {
        msg!("Creating initial global rewards account");
        
        let rent = Rent::get()?;
        let initial_space = 8;
        let initial_rent = rent.minimum_balance(initial_space);

        invoke_signed(
            &system_instruction::create_account(
                payer_account.key,
                &pda,
                initial_rent,
                initial_space as u64,
                program_id
            ),
            &[
                payer_account.clone(),
                global_rewards_account.clone(),
                system_program.clone()
            ],
            &[&[
                GLOBAL_SEED,
                GLOBAL_REWARDS_SEED,
                &[bump_seed]
            ]],
        )?;
        
        msg!("Call it again to resize to desired size");
        return Ok(());
    }

    // Step 2: Resize incrementally if needed
    let current_len = global_rewards_account.data_len();
    if current_len < GlobalRewards::LEN {
        // Calculate next size (increment by 10240 or to final size if less)
        const MAX_INCREASE: usize = 10_240;
        let target_len = std::cmp::min(current_len + MAX_INCREASE, GlobalRewards::LEN);
        
        msg!("Resizing account from {} to {} bytes (final size: {})", 
             current_len, target_len, GlobalRewards::LEN);
        
        // Calculate and transfer rent for target size
        let rent = Rent::get()?;
        let required_rent = rent.minimum_balance(target_len);
        let current_lamports = global_rewards_account.lamports();
        
        if required_rent > current_lamports {
            let lamports_diff = required_rent - current_lamports;
            
            // Use system instruction to transfer lamports
            solana_program::program::invoke(
                &system_instruction::transfer(
                    payer_account.key,
                    global_rewards_account.key,
                    lamports_diff,
                ),
                &[
                    payer_account.clone(),
                    global_rewards_account.clone(),
                    system_program.clone(),
                ],
            )?;
        }
        
        // Realloc to target size
        global_rewards_account.realloc(target_len, false)?;
        
        // If we've reached final size, initialize
        if target_len == GlobalRewards::LEN {
            let mut data = global_rewards_account.try_borrow_mut_data()?;
            data[0] = DepinAccountType::GlobalRewards as u8;
            msg!("Initialization done");
        } else {
            // Need more calls to reach final size
            let remaining_calls = ((GlobalRewards::LEN - target_len) + MAX_INCREASE - 1) / MAX_INCREASE;
            msg!("Call {} more time(s) to complete resizing", remaining_calls);
        }
    } else {
        msg!("Initialization done");
    }
    
    Ok(())
}

fn init_treasury_state<'a>(
    program_id: &Pubkey,
    payer_account: &AccountInfo<'a>,
    treasury_state_account: &AccountInfo<'a>,
    system_program: &AccountInfo<'a>
) -> ProgramResult {
    let (pda, bump_seed) = TreasuryState::find_pda(program_id);

    if *treasury_state_account.key != pda {
        msg!("Error: TreasuryState account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    if !treasury_state_account.is_writable {
        msg!("Error: TreasuryState account must be writable");
        return Err(ProgramError::InvalidArgument);
    }

    // Check if treasury state already exists
    if !treasury_state_account.data_is_empty() {
        msg!("TreasuryState already exists");
        return Ok(());
    }

    msg!("Creating TreasuryState PDA");

    // Calculate space and rent for TreasuryState account
    let space = TreasuryState::LEN;
    let rent = Rent::get()?;
    let rent_lamports = rent.minimum_balance(space);

    // Create the treasury state PDA account
    invoke_signed(
        &system_instruction::create_account(
            payer_account.key,
            &pda,
            rent_lamports,
            space as u64,
            program_id,
        ),
        &[
            payer_account.clone(),
            treasury_state_account.clone(),
            system_program.clone(),
        ],
        &[&[
            TREASURY_SEED,
            STATE_SEED,
            &[bump_seed],
        ]],
    )?;

    // Initialize the account using write_account_data helper
    let treasury_state = TreasuryState::new();
    let mut data = treasury_state_account.try_borrow_mut_data()?;
    write_account_data(&mut data, TreasuryState::account_type(), &treasury_state)?;

    msg!("TreasuryState created and initialized successfully");
    Ok(())
}

fn init_treasury_config<'a>(
    program_id: &Pubkey,
    payer_account: &AccountInfo<'a>,
    treasury_config_account: &AccountInfo<'a>,
    system_program: &AccountInfo<'a>
) -> ProgramResult {
    let (pda, bump_seed) = TreasuryConfig::find_pda(program_id);

    if *treasury_config_account.key != pda {
        msg!("Error: TreasuryConfig account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    if !treasury_config_account.is_writable {
        msg!("Error: TreasuryConfig account must be writable");
        return Err(ProgramError::InvalidArgument);
    }

    // Check if already exists
    if !treasury_config_account.data_is_empty() {
        msg!("TreasuryConfig already exists");
        return Ok(());
    }

    msg!("Creating TreasuryConfig PDA");

    let space = TreasuryConfig::LEN;
    let rent = Rent::get()?;
    let rent_lamports = rent.minimum_balance(space);

    invoke_signed(
        &system_instruction::create_account(
            payer_account.key,
            &pda,
            rent_lamports,
            space as u64,
            program_id,
        ),
        &[
            payer_account.clone(),
            treasury_config_account.clone(),
            system_program.clone(),
        ],
        &[&[
            TREASURY_SEED,
            shared::constants::seeds::CONFIG_SEED,
            &[bump_seed],
        ]],
    )?;

    // Initialize with defaults
    let config = TreasuryConfig::new();
    let mut data = treasury_config_account.try_borrow_mut_data()?;
    write_account_data(&mut data, TreasuryConfig::account_type(), &config)?;

    msg!("TreasuryConfig created and initialized successfully");
    Ok(())
}
