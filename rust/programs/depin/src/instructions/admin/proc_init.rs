use crate::shared::constants::seeds::{CHECKER_SEED, REWARDS_SEED, GLOBAL_SEED, STATE_SEED, VAULT_SEED};
use crate::shared::features::flexlock::accounts::FlexlockVault;
use crate::shared::features::rewards::accounts::{CheckerRewardsVault, GlobalRewards};
use crate::shared::features::global::accounts::BMBState;
use borsh::{BorshDeserialize, BorshSerialize};
use depin_core::constants::BMB_MINT;
use depin_core::types::account::DepinAccountType;
use depin_core::utils::account::{write_account_data, reallocate_account_if_needed};
use depin_core::utils::program_data::validate_upgrade_authority;
use depin_core::utils::tokens::initialize_ata_if_needed;
use depin_core::utils::validation::{validate_ata_account, validate_pda_account};
use solana_program::program::invoke_signed;
use solana_program::rent::Rent;
use solana_program::sysvar::Sysvar;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use solana_system_interface::instruction as system_instruction;

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct InitInput {
}

pub fn process_init_network<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    _instruction_data: &[u8],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Program upgrade authority
    // 1. [readonly] ProgramData account (contains upgrade authority)
    // 2. [writable] GlobalRewards PDA
    // 3. [writable] CheckerRewardsVault PDA
    // 4. [writable] BMBState PDA
    // 5. [readonly] BMB mint account
    // 6. [readonly] Flexlock vault account
    // 7. [writable] Flexlock vault BMB ATA account
    // 8. [readonly] Token program account
    // 9. [readonly] Associated token program account
    // 10. [] System program account (for account creation)
    let account_info_iter = &mut accounts.iter();
    let upgrade_authority_account = next_account_info(account_info_iter)?;
    let program_data_account = next_account_info(account_info_iter)?;
    let global_rewards_account = next_account_info(account_info_iter)?;
    let checker_rewards_vault_account = next_account_info(account_info_iter)?;
    let bmb_state_account = next_account_info(account_info_iter)?;
    let bmb_mint_account = next_account_info(account_info_iter)?;
    let flexlock_vault_account = next_account_info(account_info_iter)?;
    let flexlock_vault_ata_account = next_account_info(account_info_iter)?;
    let token_program_account = next_account_info(account_info_iter)?;
    let associated_token_program_account = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    // Validate upgrade authority
    validate_upgrade_authority(
        program_id,
        program_data_account,
        upgrade_authority_account
    )?;

    init_global_rewards(program_id, upgrade_authority_account, global_rewards_account, system_program)?;
    init_checker_rewards_vault(program_id, upgrade_authority_account, checker_rewards_vault_account, system_program)?;
    init_bmb_state(program_id, upgrade_authority_account, bmb_state_account, system_program)?;
    init_flexlock(program_id, upgrade_authority_account, flexlock_vault_account, flexlock_vault_ata_account, bmb_mint_account, token_program_account, associated_token_program_account, system_program)?;
    Ok(())
}

fn init_flexlock<'a>(
    program_id: &Pubkey,
    payer_account: &AccountInfo<'a>,
    flexlock_vault_account: &AccountInfo<'a>,
    flexlock_vault_ata_account: &AccountInfo<'a>,
    bmb_mint_account: &AccountInfo<'a>,
    token_program_account: &AccountInfo<'a>,
    associated_token_program_account: &AccountInfo<'a>,
    system_program: &AccountInfo<'a>
) -> ProgramResult {
    let (vault_authority_pda, _) = FlexlockVault::find_pda(program_id);

    validate_pda_account(flexlock_vault_account, &vault_authority_pda, "Flexlock Vault")?;
    validate_pda_account(bmb_mint_account, &BMB_MINT, "BMB Mint")?;
    validate_ata_account(flexlock_vault_ata_account, &vault_authority_pda, &BMB_MINT, "Flexlock Vault ATA")?;

    initialize_ata_if_needed(payer_account, flexlock_vault_account, bmb_mint_account, flexlock_vault_ata_account, token_program_account, associated_token_program_account, system_program)?;
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
                REWARDS_SEED,
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
        global_rewards_account.resize(target_len)?;
        
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

fn init_checker_rewards_vault<'a>(
    program_id: &Pubkey,
    payer_account: &AccountInfo<'a>,
    checker_rewards_vault_account: &AccountInfo<'a>,
    system_program: &AccountInfo<'a>
) -> ProgramResult {
    let (pda, bump_seed) = CheckerRewardsVault::find_pda(program_id);
    validate_pda_account(checker_rewards_vault_account, &pda, "CheckerRewardsVault")?;

    if !checker_rewards_vault_account.is_writable {
        msg!("Error: CheckerRewardsVault account must be writable");
        return Err(ProgramError::InvalidArgument);
    }

    // Check if vault already exists
    if !checker_rewards_vault_account.data_is_empty() {
        msg!("CheckerRewardsVault already exists");
        return Ok(());
    }

    msg!("Creating CheckerRewardsVault PDA");

    // Calculate space and rent for CheckerRewardsVault account
    let space = CheckerRewardsVault::LEN;
    let rent = Rent::get()?;
    let rent_lamports = rent.minimum_balance(space);

    // Create the checker rewards vault PDA account
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
            checker_rewards_vault_account.clone(),
            system_program.clone(),
        ],
        &[&[
            VAULT_SEED, REWARDS_SEED, CHECKER_SEED,
            &[bump_seed],
        ]],
    )?;

    // Initialize the account using write_account_data helper
    let vault = CheckerRewardsVault::new();
    let mut data = checker_rewards_vault_account.try_borrow_mut_data()?;
    write_account_data(&mut data, CheckerRewardsVault::account_type(), &vault)?;

    msg!("CheckerRewardsVault created and initialized successfully");
    Ok(())
}

fn init_bmb_state<'a>(
    program_id: &Pubkey,
    payer_account: &'a AccountInfo<'a>,
    bmb_state_account: &'a AccountInfo<'a>,
    system_program: &'a AccountInfo<'a>
) -> ProgramResult {
    let (pda, bump_seed) = BMBState::find_pda(program_id);

    if *bmb_state_account.key != pda {
        msg!("Error: BMBState account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    if !bmb_state_account.is_writable {
        msg!("Error: BMBState account must be writable");
        return Err(ProgramError::InvalidArgument);
    }

    let account_exists = !bmb_state_account.data_is_empty();
    let rent = Rent::get()?;

    if account_exists {
        msg!("BMBState account exists, reallocating if needed");

        // Realloc preserves existing data and zero-initializes new space
        reallocate_account_if_needed(
            payer_account,
            bmb_state_account,
            system_program,
            &rent,
            BMBState::LEN
        )?;

        msg!("BMBState updated successfully");
    } else {
        msg!("Creating BMBState PDA");

        let space = BMBState::LEN;
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
                bmb_state_account.clone(),
                system_program.clone(),
            ],
            &[&[
                GLOBAL_SEED,
                STATE_SEED,
                &[bump_seed],
            ]],
        )?;

        // Initialize with new state
        let bmb_state = BMBState::new();
        let mut data = bmb_state_account.try_borrow_mut_data()?;
        write_account_data(&mut data, BMBState::account_type(), &bmb_state)?;

        msg!("BMBState created and initialized successfully");
    }

    Ok(())
}
