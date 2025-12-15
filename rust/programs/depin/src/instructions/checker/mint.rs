use crate::shared::{
    constants::seeds::{AUTHORITY_SEED, CHECKER_SEED, LICENSE_SEED},
    features::{checker::accounts::CheckerLicenseAuthority, global::accounts::BMBState},
};

#[cfg(not(feature = "test"))]
use depin_core::constants::get_checker_collection;

use depin_core::{
    constants::{
        BMB_DECIMALS, BMB_MINT, BMB_MULTIPLIER, MNOOP_PROGRAM, MPL_ACCOUNT_COMPRESSION_PROGRAM,
        MPL_CORE_PROGRAM,
    },
    types::account::DepinAccountType,
    utils::{
        account::{read_account_data, write_account_data},
        bmb::{get_current_period, validate_checker_tree},
        tokens::initialize_ata_if_needed,
        validation::{validate_ata_account, validate_pda_account},
    },
};
use mpl_bubblegum::{
    accounts::TreeConfig,
    instructions::MintV2CpiBuilder,
    types::{Creator, MetadataArgsV2, TokenStandard},
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

pub fn process_mint_checker<'info>(
    program_id: &Pubkey,
    accounts: &'info [AccountInfo<'info>],
    _instruction_data: &[u8],
) -> ProgramResult {
    // Expected Accounts:
    // 0. [signer] Minter
    // 1. [writable] Minter's BMB token account
    // 2. [writable] Mint receiver
    // 3. [writable] Payment receiver BMB token account
    // 4. [writable] BMB state account
    // 5. [writable] Merkle tree account
    // 6. [writable] Tree config PDA (derived from merkle tree)
    // 7. [readonly] Checker authority PDA (tree and collection authority)
    // 8. [readonly] Collection mint
    // 9. [readonly] Bubblegum program
    // 10. [readonly] System program
    // 11. [readonly] SPL Token program
    // 12. [readonly] Associated Token program
    // 13. [readonly] Account Compression program
    // 14. [readonly] BMB mint
    // 15. [readonly] Log wrapper (noop program)
    // 16. [readonly] MPL Core program

    let account_info_iter = &mut accounts.iter();
    let minter_account = next_account_info(account_info_iter)?;
    let minter_bmb_token_account = next_account_info(account_info_iter)?;
    let mint_receiver_account = next_account_info(account_info_iter)?;
    let payment_receiver_bmb_token_account = next_account_info(account_info_iter)?;
    let bmb_state_account = next_account_info(account_info_iter)?;
    let merkle_tree_account = next_account_info(account_info_iter)?;
    let tree_config_account = next_account_info(account_info_iter)?;
    let checker_authority_account = next_account_info(account_info_iter)?;
    let collection_mint_account = next_account_info(account_info_iter)?;
    let bubblegum_program_account = next_account_info(account_info_iter)?;
    let system_program_account = next_account_info(account_info_iter)?;
    let token_program_account = next_account_info(account_info_iter)?;
    let associated_token_program_account = next_account_info(account_info_iter)?;
    let account_compression_program_account = next_account_info(account_info_iter)?;
    let bmb_mint_account = next_account_info(account_info_iter)?;
    let noop_program_account = next_account_info(account_info_iter)?;
    let mpl_core_program_account = next_account_info(account_info_iter)?;

    // Validate minter is signer
    if !minter_account.is_signer {
        msg!("Error: Minter account must be a signer");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate System program
    if *system_program_account.key != solana_sdk_ids::system_program::ID {
        msg!("Error: Invalid System program account");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate Token program
    if *token_program_account.key != spl_token::ID {
        msg!("Error: Invalid Token program account");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate Associated Token program
    if *associated_token_program_account.key != spl_associated_token_account::ID {
        msg!("Error: Invalid Associated Token program account");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate Bubblegum program
    if *bubblegum_program_account.key != mpl_bubblegum::ID {
        msg!("Error: Invalid Bubblegum program account");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate BMBState PDA
    let (bmb_state_pda, _) = BMBState::find_pda(program_id);
    validate_pda_account(bmb_state_account, &bmb_state_pda, "BMBState")?;

    // Validate license authority PDA
    let (checker_license_authority_pda, authority_bump) =
        CheckerLicenseAuthority::find_pda(program_id);
    validate_pda_account(
        checker_authority_account,
        &checker_license_authority_pda,
        "Checker Authority PDA",
    )?;

    // Validate BMB mint
    if bmb_mint_account.key != &depin_core::constants::BMB_MINT {
        msg!("Error: BMB mint account does not match expected BMB mint");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate Noop program
    if *noop_program_account.key != MNOOP_PROGRAM {
        msg!("Error: Noop program account is not the expected noop program");
        return Err(ProgramError::InvalidArgument);
    }

    if *account_compression_program_account.key != MPL_ACCOUNT_COMPRESSION_PROGRAM {
        msg!("Error: Invalid Account Compression program account");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate MPL Core program
    if *mpl_core_program_account.key != MPL_CORE_PROGRAM {
        msg!("Error: Invalid MPL Core program account");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate Tree Config PDA
    let (expected_tree_config, _) = Pubkey::find_program_address(&[merkle_tree_account.key.as_ref()], &mpl_bubblegum::ID);
    validate_pda_account(tree_config_account, &expected_tree_config, "Tree Config")?;

    // Validate merkle tree account
    validate_checker_tree(merkle_tree_account.key)?;

    // Validate collection mint account
    #[cfg(not(feature = "test"))]
    if *collection_mint_account.key != get_checker_collection() {
        msg!("Error: Collection mint account does not match expected checker collection");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate payment receiver is correct
    validate_ata_account(
        payment_receiver_bmb_token_account,
        checker_authority_account.key,
        &BMB_MINT,
        "Payment Receiver BMB Token Account",
    )?;

    // Validate minter's BMB token account
    validate_ata_account(
        minter_bmb_token_account,
        minter_account.key,
        &BMB_MINT,
        "Minter BMB Token Account",
    )?;

    let price = 50_000 * BMB_MULTIPLIER;

    initialize_ata_if_needed(
        minter_account,
        checker_authority_account,
        bmb_mint_account,
        payment_receiver_bmb_token_account,
        token_program_account,
        associated_token_program_account,
        system_program_account,
    )?;

    // Transfer BMB tokens from minter to payment receiver
    let transfer_ix = transfer_checked(
        token_program_account.key,
        minter_bmb_token_account.key,
        bmb_mint_account.key,
        payment_receiver_bmb_token_account.key,
        minter_account.key,
        &[],
        price,
        BMB_DECIMALS,
    )?;

    invoke(
        &transfer_ix,
        &[
            minter_bmb_token_account.clone(),
            bmb_mint_account.clone(),
            payment_receiver_bmb_token_account.clone(),
            minter_account.clone(),
            token_program_account.clone(),
        ],
    )?;

    // Prepare metadata
    let metadata = MetadataArgsV2 {
        name: "Checker Node License".to_string(),
        symbol: "".to_string(),
        uri: "https://arweave.net/3hW4DfFPRNgcsQ47_UfBgWG4KkKzMcbcjZGIjWwDByM".to_string(),
        seller_fee_basis_points: 0,
        primary_sale_happened: false,
        is_mutable: true,
        creators: vec![
            Creator {
                address: *checker_authority_account.key,
                verified: true,
                share: 100,
            },
            Creator {
                address: *minter_account.key,
                verified: true,
                share: 0,
            },
        ],
        token_standard: Some(TokenStandard::NonFungible),
        collection: if collection_mint_account.key != &solana_sdk_ids::system_program::ID {
            Some(*collection_mint_account.key)
        } else {
            None
        },
    };

    // Mint the checker cNFT
    let mut builder = MintV2CpiBuilder::new(bubblegum_program_account);
    let mut cpi_builder = builder
        .tree_config(tree_config_account)
        .leaf_owner(mint_receiver_account)
        .leaf_delegate(Some(mint_receiver_account))
        .merkle_tree(merkle_tree_account)
        .payer(minter_account)
        .tree_creator_or_delegate(Some(checker_authority_account))
        .metadata(metadata)
        .compression_program(account_compression_program_account)
        .mpl_core_program(mpl_core_program_account)
        .system_program(system_program_account)
        .log_wrapper(noop_program_account);

    if collection_mint_account.key != &solana_sdk_ids::system_program::ID {
        cpi_builder = cpi_builder.core_collection(Some(collection_mint_account));
    }

    cpi_builder.invoke_signed(&[&[
        CHECKER_SEED,
        LICENSE_SEED,
        AUTHORITY_SEED,
        &[authority_bump],
    ]])?;

    // Activate checker in BMBState
    let mut bmb_state: BMBState = read_account_data(
        &bmb_state_account.try_borrow_data()?,
        DepinAccountType::BMBState,
    )?;

    let tree_config_data = tree_config_account.try_borrow_data()?;
    let tree_config = TreeConfig::from_bytes(&tree_config_data)?;

    // Set checker count for next period (BRAND)
    bmb_state.set_period_checkers(get_current_period() + 1, tree_config.num_minted as u32);
    let mut data = bmb_state_account.try_borrow_mut_data()?;
    write_account_data(&mut data, BMBState::account_type(), &bmb_state)?;

    Ok(())
}
