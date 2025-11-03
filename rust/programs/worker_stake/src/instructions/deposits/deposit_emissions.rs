use depin_core::{
    constants::{BMB_MINT, BMB_DECIMALS},
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
    utils::{
        find_bmb_treasury_pda,
        initialize_pool_with_inheritance,
        validate_pda_account,
        validate_ata_account,
        validate_mint,
        require_signer,
        MAX_BASIS_POINTS,
    }
};

pub fn process_deposit_emissions<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    month_period: u16,
    amount: u64,
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer, writable] Foundation treasury wallet (payer for ATA)
    // 1. [readonly] Worker collection (Metaplex Core collection)
    // 2. [writable] WorkerStakeConfig PDA
    // 3. [writable] Foundation BMB token account (source)
    // 4. [readonly] BMB treasury PDA
    // 5. [writable] BMB treasury ATA (destination)
    // 6. [writable] Worker wallet (for ATA creation)
    // 7. [writable] Worker wallet BMB account (destination)
    // 8. [readonly] BMB mint
    // 9. [readonly] Token program
    // 10. [readonly] Associated token program
    // 11. [readonly] System program
    // Remaining accounts:
    // - [writable] MonthlyPool for specified month (if exists)
    // - [writable, optional] Previous MonthlyPool (if last_active_pool_month > 0)

    let account_info_iter = &mut accounts.iter();
    let depositor_wallet = next_account_info(account_info_iter)?;
    let worker_collection_account = next_account_info(account_info_iter)?;
    let worker_stake_config_account = next_account_info(account_info_iter)?;
    let foundation_bmb_account = next_account_info(account_info_iter)?;
    let bmb_treasury_pda = next_account_info(account_info_iter)?;
    let bmb_treasury_ata = next_account_info(account_info_iter)?;
    let worker_wallet_account = next_account_info(account_info_iter)?;
    let worker_wallet_bmb = next_account_info(account_info_iter)?;
    let bmb_mint_account = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;
    let associated_token_program = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    // Remaining accounts (optional pool account)
    let remaining_accounts: Vec<&AccountInfo> = account_info_iter.collect();

    // Validate Depositor signature
    require_signer(depositor_wallet, "Depositor wallet")?;

    // Validate BMB mint
    validate_mint(bmb_mint_account, &BMB_MINT, "BMB")?;

    // Get current month
    let current_period = get_current_period();
    let current_month_period = get_month_from_period(current_period);

    // Validate month_period <= current_month_period
    if month_period > current_month_period {
        msg!(
            "Error: Cannot deposit emissions for future month {} (current: {})",
            month_period,
            current_month_period
        );
        return Err(ProgramError::InvalidArgument);
    }

    // Validate WorkerStakeConfig PDA
    let (config_pda, _bump) = WorkerStakeConfig::find_pda(program_id, worker_collection_account.key);
    validate_pda_account(worker_stake_config_account, &config_pda, "WorkerStakeConfig")?;

    // Load config
    let config_data = worker_stake_config_account.try_borrow_data()?;
    let mut config: WorkerStakeConfig = read_account_data(&config_data, WorkerStakeAccountType::WorkerStakeConfig)?;
    let worker_wallet = config.worker_wallet; // Extract for later use
    drop(config_data);

    // Check if pool exists for this month
    let has_pool = config.created_pools.contains(&month_period);

    if has_pool {
        // Get monthly pool account
        let monthly_pool_account = remaining_accounts.get(0).ok_or_else(|| {
            msg!("Error: MonthlyPool account required when pool exists");
            ProgramError::NotEnoughAccountKeys
        })?;

        // Validate MonthlyPool PDA
        let (pool_pda, _pool_bump) = MonthlyPool::find_pda(program_id, worker_collection_account.key, month_period);
        validate_pda_account(monthly_pool_account, &pool_pda, "MonthlyPool")?;

        // Load monthly pool
        let pool_data = monthly_pool_account.try_borrow_data()?;
        let mut monthly_pool: MonthlyPool = read_account_data(&pool_data, WorkerStakeAccountType::MonthlyPool)?;
        drop(pool_data);

        // Initialize pool if needed (with inheritance)
        let prev_pool_account = if config.last_active_pool_month > 0 {
            remaining_accounts.get(1).copied()
        } else {
            None
        };

        initialize_pool_with_inheritance(
            program_id,
            worker_collection_account.key,
            month_period,
            &mut monthly_pool,
            &mut config,
            prev_pool_account,
        )?;

        // For past months: validate collected_bmb_base == 0 (one-time retroactive deposit)
        if month_period < current_month_period && monthly_pool.collected_bmb_base > 0 {
            msg!(
                "Error: Emissions already deposited for past month {} (collected: {})",
                month_period,
                monthly_pool.collected_bmb_base
            );
            return Err(ProgramError::InvalidArgument);
        }

        // Calculate shares
        let base_share = (amount as u128)
            .checked_mul(monthly_pool.base_emission_percentage as u128)
            .ok_or(ProgramError::ArithmeticOverflow)?
            .checked_div(MAX_BASIS_POINTS as u128)
            .ok_or(ProgramError::ArithmeticOverflow)? as u64;

        let worker_remainder = amount
            .checked_sub(base_share)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        // Validate BMB treasury PDA
        let (expected_treasury_pda, _treasury_bump) = find_bmb_treasury_pda(program_id, worker_collection_account.key);
        validate_pda_account(bmb_treasury_pda, &expected_treasury_pda, "BMB treasury")?;

        // Validate BMB treasury ATA
        validate_ata_account(bmb_treasury_ata, bmb_treasury_pda.key, bmb_mint_account.key, "BMB treasury")?;

        // Initialize BMB treasury ATA if needed (lazy)
        initialize_ata_if_needed(
            depositor_wallet,
            bmb_treasury_pda,
            bmb_mint_account,
            bmb_treasury_ata,
            token_program,
            associated_token_program,
            system_program,
        )?;

        // Validate worker wallet account matches config
        if *worker_wallet_account.key != worker_wallet {
            msg!("Error: Worker wallet account does not match config");
            return Err(ProgramError::InvalidArgument);
        }

        // Initialize worker wallet BMB ATA if needed (lazy, idempotent)
        initialize_ata_if_needed(
            depositor_wallet,
            worker_wallet_account,
            bmb_mint_account,
            worker_wallet_bmb,
            token_program,
            associated_token_program,
            system_program,
        )?;

        // Transfer base share to BMB treasury
        if base_share > 0 {
            let transfer_ix = transfer_checked(
                token_program.key,
                foundation_bmb_account.key,
                bmb_mint_account.key,
                bmb_treasury_ata.key,
                depositor_wallet.key,
                &[],
                base_share,
                BMB_DECIMALS,
            )?;

            invoke(
                &transfer_ix,
                &[
                    foundation_bmb_account.clone(),
                    bmb_mint_account.clone(),
                    bmb_treasury_ata.clone(),
                    depositor_wallet.clone(),
                    token_program.clone(),
                ],
            )?;
        }

        // Transfer remainder to worker wallet
        if worker_remainder > 0 {
            let transfer_ix = transfer_checked(
                token_program.key,
                foundation_bmb_account.key,
                bmb_mint_account.key,
                worker_wallet_bmb.key,
                depositor_wallet.key,
                &[],
                worker_remainder,
                BMB_DECIMALS,
            )?;

            invoke(
                &transfer_ix,
                &[
                    foundation_bmb_account.clone(),
                    bmb_mint_account.clone(),
                    worker_wallet_bmb.clone(),
                    depositor_wallet.clone(),
                    token_program.clone(),
                ],
            )?;
        }

        // Update pool collected_bmb_base (cumulative for current month)
        monthly_pool.collected_bmb_base = monthly_pool.collected_bmb_base
            .checked_add(base_share)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        // Save updated pool
        let mut pool_data = monthly_pool_account.try_borrow_mut_data()?;
        write_account_data(&mut pool_data, WorkerStakeAccountType::MonthlyPool, &monthly_pool)?;

        // Save updated config (in case inheritance ran)
        let mut config_data = worker_stake_config_account.try_borrow_mut_data()?;
        write_account_data(&mut config_data, WorkerStakeAccountType::WorkerStakeConfig, &config)?;

        msg!(
            "Deposited emissions for month {}: {} BMB total (base: {}, worker: {})",
            month_period,
            amount,
            base_share,
            worker_remainder
        );
    } else {
        // No pool - full amount to worker wallet

        // Validate worker wallet account matches config
        if *worker_wallet_account.key != worker_wallet {
            msg!("Error: Worker wallet account does not match config");
            return Err(ProgramError::InvalidArgument);
        }

        // Initialize worker wallet BMB ATA if needed (lazy, idempotent)
        initialize_ata_if_needed(
            depositor_wallet,
            worker_wallet_account,
            bmb_mint_account,
            worker_wallet_bmb,
            token_program,
            associated_token_program,
            system_program,
        )?;

        let transfer_ix = transfer_checked(
            token_program.key,
            foundation_bmb_account.key,
            bmb_mint_account.key,
            worker_wallet_bmb.key,
            depositor_wallet.key,
            &[],
            amount,
            BMB_DECIMALS,
        )?;

        invoke(
            &transfer_ix,
            &[
                foundation_bmb_account.clone(),
                bmb_mint_account.clone(),
                worker_wallet_bmb.clone(),
                depositor_wallet.clone(),
                token_program.clone(),
            ],
        )?;

        msg!("No pool exists for month {}. Full {} BMB sent to worker", month_period, amount);
    }

    Ok(())
}
