use depin_core::{
    constants::USDC_MINT,
    utils::{
        account::{read_account_data, write_account_data},
        bmb::{get_current_period, get_month_from_period},
        tokens::initialize_ata_if_needed,
    },
};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use spl_token::instruction::transfer_checked;
use crate::{
    state::{WorkerStakeConfig, MonthlyPool},
    types::WorkerStakeAccountType,
    utils::{find_usdc_treasury_pda, initialize_pool_with_inheritance, MAX_BASIS_POINTS},
};

const USDC_DECIMALS: u8 = 6;

pub fn process_deposit_revenue<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    worker_collection: Pubkey,
    total_revenue: u64,
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer, writable] Revenue source authority (payer for ATA)
    // 1. [writable] WorkerStakeConfig PDA
    // 2. [writable] Revenue source USDC account
    // 3. [readonly] USDC treasury PDA
    // 4. [writable] USDC treasury ATA (destination)
    // 5. [writable] Worker wallet USDC account (destination)
    // 6. [readonly] USDC mint
    // 7. [readonly] Token program
    // 8. [readonly] Associated token program
    // 9. [readonly] System program
    // Remaining accounts:
    // - [writable] MonthlyPool for current month (if exists)
    // - [writable, optional] Previous MonthlyPool (if last_active_pool_month > 0)

    let account_info_iter = &mut accounts.iter();
    let revenue_authority = next_account_info(account_info_iter)?;
    let worker_stake_config_account = next_account_info(account_info_iter)?;
    let revenue_source_account = next_account_info(account_info_iter)?;
    let usdc_treasury_pda = next_account_info(account_info_iter)?;
    let usdc_treasury_ata = next_account_info(account_info_iter)?;
    let worker_wallet_usdc = next_account_info(account_info_iter)?;
    let usdc_mint_account = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;
    let associated_token_program = next_account_info(account_info_iter)?;
    let _system_program = next_account_info(account_info_iter)?;

    // Collect remaining accounts (pool accounts only)
    let pool_accounts: Vec<&AccountInfo> = account_info_iter.collect();

    // Validate revenue authority signature
    if !revenue_authority.is_signer {
        msg!("Error: Revenue authority must sign the transaction");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate USDC mint
    if *usdc_mint_account.key != USDC_MINT {
        msg!("Error: Invalid USDC mint");
        return Err(ProgramError::InvalidArgument);
    }

    // Get current month
    let current_period = get_current_period();
    let current_month_period = get_month_from_period(current_period);

    // Validate WorkerStakeConfig PDA
    let (config_pda, _bump) = WorkerStakeConfig::find_pda(program_id, &worker_collection);
    if *worker_stake_config_account.key != config_pda {
        msg!("Error: WorkerStakeConfig account does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Load config
    let config_data = worker_stake_config_account.try_borrow_data()?;
    let mut config: WorkerStakeConfig = read_account_data(&config_data, WorkerStakeAccountType::WorkerStakeConfig)?;
    drop(config_data);

    // Check if current month has pool
    let has_pool = config.created_pools.contains(&current_month_period);

    if has_pool {
        // Get monthly pool account
        let monthly_pool_account = pool_accounts.get(0).ok_or_else(|| {
            msg!("Error: MonthlyPool account required when pool exists");
            ProgramError::NotEnoughAccountKeys
        })?;

        // Validate MonthlyPool PDA
        let (pool_pda, _pool_bump) = MonthlyPool::find_pda(program_id, &worker_collection, current_month_period);
        if *monthly_pool_account.key != pool_pda {
            msg!("Error: MonthlyPool account does not match expected PDA");
            return Err(ProgramError::InvalidArgument);
        }

        // Load monthly pool
        let pool_data = monthly_pool_account.try_borrow_data()?;
        let mut monthly_pool: MonthlyPool = read_account_data(&pool_data, WorkerStakeAccountType::MonthlyPool)?;
        drop(pool_data);

        // Initialize pool if needed (with inheritance)
        let prev_pool_account = if config.last_active_pool_month > 0 {
            pool_accounts.get(1).copied()
        } else {
            None
        };

        initialize_pool_with_inheritance(
            program_id,
            &worker_collection,
            current_month_period,
            &mut monthly_pool,
            &mut config,
            prev_pool_account,
        )?;

        // Calculate shares
        let base_share = (total_revenue as u128)
            .checked_mul(monthly_pool.base_revenue_percentage as u128)
            .ok_or(ProgramError::ArithmeticOverflow)?
            .checked_div(MAX_BASIS_POINTS as u128)
            .ok_or(ProgramError::ArithmeticOverflow)? as u64;

        let addon_share = (total_revenue as u128)
            .checked_mul(monthly_pool.addon_revenue_percentage as u128)
            .ok_or(ProgramError::ArithmeticOverflow)?
            .checked_div(MAX_BASIS_POINTS as u128)
            .ok_or(ProgramError::ArithmeticOverflow)? as u64;

        let community_total = base_share
            .checked_add(addon_share)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        let worker_remainder = total_revenue
            .checked_sub(community_total)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        // Validate USDC treasury PDA
        let (expected_treasury_pda, _treasury_bump) = find_usdc_treasury_pda(program_id, &worker_collection);
        if *usdc_treasury_pda.key != expected_treasury_pda {
            msg!("Error: USDC treasury PDA does not match expected address");
            return Err(ProgramError::InvalidArgument);
        }

        // Validate USDC treasury ATA
        let expected_treasury_ata = spl_associated_token_account::get_associated_token_address(
            usdc_treasury_pda.key,
            usdc_mint_account.key,
        );
        if *usdc_treasury_ata.key != expected_treasury_ata {
            msg!("Error: USDC treasury ATA does not match expected address");
            return Err(ProgramError::InvalidArgument);
        }

        // Initialize USDC treasury ATA if needed (lazy)
        initialize_ata_if_needed(
            revenue_authority,
            usdc_treasury_pda,
            usdc_mint_account,
            usdc_treasury_ata,
            token_program,
            associated_token_program,
        )?;

        // Transfer community share to USDC treasury
        if community_total > 0 {
            let transfer_ix = transfer_checked(
                token_program.key,
                revenue_source_account.key,
                usdc_mint_account.key,
                usdc_treasury_ata.key,
                revenue_authority.key,
                &[],
                community_total,
                USDC_DECIMALS,
            )?;

            invoke(
                &transfer_ix,
                &[
                    revenue_source_account.clone(),
                    usdc_mint_account.clone(),
                    usdc_treasury_ata.clone(),
                    revenue_authority.clone(),
                    token_program.clone(),
                ],
            )?;
        }

        // Transfer remainder to worker wallet
        if worker_remainder > 0 {
            let transfer_ix = transfer_checked(
                token_program.key,
                revenue_source_account.key,
                usdc_mint_account.key,
                worker_wallet_usdc.key,
                revenue_authority.key,
                &[],
                worker_remainder,
                USDC_DECIMALS,
            )?;

            invoke(
                &transfer_ix,
                &[
                    revenue_source_account.clone(),
                    usdc_mint_account.clone(),
                    worker_wallet_usdc.clone(),
                    revenue_authority.clone(),
                    token_program.clone(),
                ],
            )?;
        }

        // Update pool collected amounts
        monthly_pool.base_pool.collected = monthly_pool.base_pool.collected
            .checked_add(base_share)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        monthly_pool.addon_pool.collected = monthly_pool.addon_pool.collected
            .checked_add(addon_share)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        // Save updated pool
        let mut pool_data = monthly_pool_account.try_borrow_mut_data()?;
        write_account_data(&mut pool_data, WorkerStakeAccountType::MonthlyPool, &monthly_pool)?;

        // Save updated config (in case inheritance ran)
        let mut config_data = worker_stake_config_account.try_borrow_mut_data()?;
        write_account_data(&mut config_data, WorkerStakeAccountType::WorkerStakeConfig, &config)?;

        msg!(
            "Deposited revenue: {} USDC total (base: {}, addon: {}, worker: {})",
            total_revenue,
            base_share,
            addon_share,
            worker_remainder
        );
    } else {
        // No pool - full revenue to worker wallet
        let transfer_ix = transfer_checked(
            token_program.key,
            revenue_source_account.key,
            usdc_mint_account.key,
            worker_wallet_usdc.key,
            revenue_authority.key,
            &[],
            total_revenue,
            USDC_DECIMALS,
        )?;

        invoke(
            &transfer_ix,
            &[
                revenue_source_account.clone(),
                usdc_mint_account.clone(),
                worker_wallet_usdc.clone(),
                revenue_authority.clone(),
                token_program.clone(),
            ],
        )?;

        msg!("No pool exists. Full {} USDC revenue sent to worker", total_revenue);
    }

    Ok(())
}
