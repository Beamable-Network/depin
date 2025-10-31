import {
    bmbToBaseUnits,
    InitializeWorkerStakeConfig,
    SetMonthlyPool,
    Stake,
    MonthlyPoolConfig,
    WorkerStakeConfigAccount,
    MonthlyPoolAccount,
    UserStakePositionAccount,
    WORKER_STAKE_PROGRAM,
    BMB_MINT
} from '@beamable-network/depin';
import { Address, address } from 'gill';
import { beforeEach, describe, expect, it } from 'vitest';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';
import { setupTokens, TokenAuthorities } from '../../helpers/spl-tokens.js';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { AssetWithProof } from '@metaplex-foundation/mpl-bubblegum';

describe('User Stake Instructions', async () => {
    let lite: LiteDepin;
    let stakeAdmin: LiteKeyPair;
    let workerCollection: Address;
    let tokenAuthorities: TokenAuthorities;
    let collectionCreator: LiteKeyPair;
    let workerWallet: LiteKeyPair;
    let worker: LiteKeyPair;
    let workerLicense: AssetWithProof;

    beforeEach(async () => {
        lite = new LiteDepin();

        // Set clock to period 5
        lite.goToMonthPeriod(5);

        // Setup admin
        stakeAdmin = await lite.generateKeyPair();
        await lite.airdrop(stakeAdmin, 10);
        lite.setProgramUpgradeAuthority(WORKER_STAKE_PROGRAM, stakeAdmin.web3PublicKey);

        // Setup tokens
        tokenAuthorities = await setupTokens(lite);

        // Setup collection
        collectionCreator = await lite.generateKeyPair();
        await lite.airdrop(collectionCreator, 10);
        await lite.createLicenseTree({ creator: collectionCreator });
        workerCollection = address(lite.getCollectionMint()!.publicKey);

        // Setup worker wallet
        workerWallet = await lite.generateKeyPair();
        await lite.airdrop(workerWallet, 2);

        // Mint worker license
        worker = await lite.generateKeyPair();
        await lite.airdrop(worker, 2);
        workerLicense = await lite.mintLicense({
            creator: collectionCreator,
            to: worker,
        });

        // Initialize worker stake config
        const initConfig = new InitializeWorkerStakeConfig({
            payer: stakeAdmin.address,
            upgrade_authority: stakeAdmin.address,
            worker_collection: workerCollection,
            worker_wallet: workerWallet.address,
            min_stake_requirement: bmbToBaseUnits(100), // 100 BMB
        });

        lite.buildTransaction()
            .addInstruction(await initConfig.getInstruction())
            .sendTransaction({ payer: stakeAdmin });

        // Create a monthly pool for current month (month_period: 5)
        const pools: MonthlyPoolConfig[] = [{
            month_period: 5,
            base_revenue_percentage: 2000, // 20%
            addon_revenue_percentage: 1000, // 10%
            base_emission_percentage: 1500, // 15%
        }];

        const setPool = new SetMonthlyPool({
            collection_authority: collectionCreator.address,
            worker_collection: workerCollection,
            pools,
        });

        lite.buildTransaction()
            .addInstruction(await setPool.getInstruction())
            .sendTransaction({ payer: collectionCreator });
    });

    describe('Basic Staking', () => {
        it('should successfully stake BMB tokens without checker licenses', async () => {
            const user = await lite.generateKeyPair();
            await lite.airdrop(user, 2);

            const stakeAmount = bmbToBaseUnits(5000); // 5000 BMB

            // Mint BMB to user
            await lite.mintToken(BMB_MINT, user.address, stakeAmount, tokenAuthorities.bmbMintAuthority);

            // Get user's token account
            const [userTokenAccount] = await findAssociatedTokenPda({
                mint: BMB_MINT,
                owner: user.address,
                tokenProgram: TOKEN_PROGRAM_ADDRESS
            });

            // Stake with 0 checker licenses
            const stake = new Stake({
                user: user.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: stakeAmount,
                checker_count: 0,
                current_month_period: 5,
                user_token_account: userTokenAccount,
            });

            lite.buildTransaction()
                .addInstruction(await stake.getInstruction())
                .sign(worker)
                .sendTransaction({ payer: user });

            // Verify user position was created
            const [userPositionPda] = await UserStakePositionAccount.findUserStakePositionPDA(user.address, workerCollection);
            const positionData = lite.getAccountData(userPositionPda);
            expect(positionData).not.toBeNull();

            const position = UserStakePositionAccount.deserializeFrom(positionData!);
            expect(position.user).toBe(user.address);
            expect(position.worker_collection).toBe(workerCollection);
            expect(position.staked_amount).toBe(stakeAmount);
            expect(position.stake_entries).toHaveLength(1);
            expect(position.stake_entries[0].amount).toBe(stakeAmount);
            expect(position.stake_entries[0].checker_count).toBe(0);
            expect(position.opted_out_at_month_period).toBe(0);
            expect(position.last_claimed_month_period).toBe(0);

            // Verify pool was updated
            const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            const poolData = lite.getAccountData(poolPda);
            const pool = MonthlyPoolAccount.deserializeFrom(poolData!);
            expect(pool.base_pool.total).toBe(stakeAmount);
            expect(pool.addon_pool.total).toBe(0n); // No checker licenses

            // Verify config total_staked was updated
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);
            expect(config.total_staked).toBe(stakeAmount);

            // Verify tokens were transferred
            const finalBalance = await lite.getTokenBalance(BMB_MINT, user.address);
            expect(finalBalance).toBe(0n);
        });

        it('should successfully stake BMB tokens with checker licenses', async () => {
            const user = await lite.generateKeyPair();
            await lite.airdrop(user, 2);

            const stakeAmount = bmbToBaseUnits(7500); // 7500 BMB
            const checkerCount = 3; // 3 checker licenses

            // Mint BMB to user
            await lite.mintToken(BMB_MINT, user.address, stakeAmount, tokenAuthorities.bmbMintAuthority);

            const [userTokenAccount] = await findAssociatedTokenPda({
                mint: BMB_MINT,
                owner: user.address,
                tokenProgram: TOKEN_PROGRAM_ADDRESS
            });

            

            const stake = new Stake({
                user: user.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: stakeAmount,
                checker_count: checkerCount,
                current_month_period: 5,
                user_token_account: userTokenAccount,
            });

            lite.buildTransaction()
                .addInstruction(await stake.getInstruction())
                .sign(worker)
                .sendTransaction({ payer: user });

            // Verify user position
            const [userPositionPda] = await UserStakePositionAccount.findUserStakePositionPDA(user.address, workerCollection);
            const positionData = lite.getAccountData(userPositionPda);
            const position = UserStakePositionAccount.deserializeFrom(positionData!);

            expect(position.staked_amount).toBe(stakeAmount);
            expect(position.stake_entries[0].checker_count).toBe(checkerCount);

            // Verify pool addon points (min(3, 7500/2500) = 3)
            const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            const poolData = lite.getAccountData(poolPda);
            const pool = MonthlyPoolAccount.deserializeFrom(poolData!);
            expect(pool.addon_pool.total).toBe(3n); // 3 points
        });

        it('should calculate points correctly when stake is insufficient', async () => {
            const user = await lite.generateKeyPair();
            await lite.airdrop(user, 2);

            const stakeAmount = bmbToBaseUnits(5000); // 5000 BMB
            const checkerCount = 3; // 3 checker licenses, but only enough stake for 2 points

            await lite.mintToken(BMB_MINT, user.address, stakeAmount, tokenAuthorities.bmbMintAuthority);

            const [userTokenAccount] = await findAssociatedTokenPda({
                mint: BMB_MINT,
                owner: user.address,
                tokenProgram: TOKEN_PROGRAM_ADDRESS
            });

            const stake = new Stake({
                user: user.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: stakeAmount,
                checker_count: checkerCount,
                current_month_period: 5,
                user_token_account: userTokenAccount,
            });

            lite.buildTransaction()
                .addInstruction(await stake.getInstruction())
                .sign(worker)
                .sendTransaction({ payer: user });

            // Verify addon points (min(3, 5000/2500) = 2)
            const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            const poolData = lite.getAccountData(poolPda);
            const pool = MonthlyPoolAccount.deserializeFrom(poolData!);
            expect(pool.addon_pool.total).toBe(2n); // Limited by stake
        });

        it('should fail when staking zero amount', async () => {
            const user = await lite.generateKeyPair();
            await lite.airdrop(user, 2);

            const [userTokenAccount] = await findAssociatedTokenPda({
                mint: BMB_MINT,
                owner: user.address,
                tokenProgram: TOKEN_PROGRAM_ADDRESS
            });

            

            const stake = new Stake({
                user: user.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: 0n,
                checker_count: 0,
                current_month_period: 5,
                user_token_account: userTokenAccount,
            });

            await expect(async () => {
                lite.buildTransaction()
                    .addInstruction(await stake.getInstruction())
                    .sign(worker)
                    .sendTransaction({ payer: user });
            }).rejects.toThrow("Amount must be greater than 0");
        });

        it('should fail when no monthly pool exists for current month', async () => {
            const user = await lite.generateKeyPair();
            await lite.airdrop(user, 2);

            const stakeAmount = bmbToBaseUnits(5000);
            await lite.mintToken(BMB_MINT, user.address, stakeAmount, tokenAuthorities.bmbMintAuthority);

            const [userTokenAccount] = await findAssociatedTokenPda({
                mint: BMB_MINT,
                owner: user.address,
                tokenProgram: TOKEN_PROGRAM_ADDRESS
            });

            

            // Try to stake for a month without a pool (month_period: 10)
            const stake = new Stake({
                user: user.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: stakeAmount,
                checker_count: 0,
                current_month_period: 10,
                user_token_account: userTokenAccount,
            });

            await expect(async () => {
                lite.buildTransaction()
                    .addInstruction(await stake.getInstruction())
                    .sign(worker)
                    .sendTransaction({ payer: user });
            }).rejects.toThrow();
        });

        it('should fail when worker signature is missing', async () => {
            const user = await lite.generateKeyPair();
            await lite.airdrop(user, 2);

            const stakeAmount = bmbToBaseUnits(5000);
            await lite.mintToken(BMB_MINT, user.address, stakeAmount, tokenAuthorities.bmbMintAuthority);

            const [userTokenAccount] = await findAssociatedTokenPda({
                mint: BMB_MINT,
                owner: user.address,
                tokenProgram: TOKEN_PROGRAM_ADDRESS
            });

            

            const stake = new Stake({
                user: user.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: stakeAmount,
                checker_count: 2,
                current_month_period: 5,
                user_token_account: userTokenAccount,
            });

            await expect(async () => {
                // Missing worker signer
                lite.buildTransaction()
                    .addInstruction(await stake.getInstruction())
                    .sendTransaction({ payer: user });
            }).rejects.toThrow();
        });
    });

    describe('Multiple Stakes', () => {
        it('should allow user to stake multiple times in same month', async () => {
            const user = await lite.generateKeyPair();
            await lite.airdrop(user, 2);

            const firstStake = bmbToBaseUnits(3000);
            const secondStake = bmbToBaseUnits(2500);
            const totalMint = firstStake + secondStake;

            await lite.mintToken(BMB_MINT, user.address, totalMint, tokenAuthorities.bmbMintAuthority);

            const [userTokenAccount] = await findAssociatedTokenPda({
                mint: BMB_MINT,
                owner: user.address,
                tokenProgram: TOKEN_PROGRAM_ADDRESS
            });

            

            // First stake
            let stake = new Stake({
                user: user.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: firstStake,
                checker_count: 0,
                current_month_period: 5,
                user_token_account: userTokenAccount,
            });

            lite.buildTransaction()
                .addInstruction(await stake.getInstruction())
                .sign(worker)
                .sendTransaction({ payer: user });

            // Second stake
            stake = new Stake({
                user: user.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: secondStake,
                checker_count: 0,
                current_month_period: 5,
                user_token_account: userTokenAccount,
            });

            lite.buildTransaction()
                .addInstruction(await stake.getInstruction())
                .sign(worker)
                .sendTransaction({ payer: user });

            // Verify position has 2 entries
            const [userPositionPda] = await UserStakePositionAccount.findUserStakePositionPDA(user.address, workerCollection);
            const positionData = lite.getAccountData(userPositionPda);
            const position = UserStakePositionAccount.deserializeFrom(positionData!);

            expect(position.staked_amount).toBe(firstStake + secondStake);
            expect(position.stake_entries).toHaveLength(2);
            expect(position.stake_entries[0].amount).toBe(firstStake);
            expect(position.stake_entries[1].amount).toBe(secondStake);

            // Verify pool total
            const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            const poolData = lite.getAccountData(poolPda);
            const pool = MonthlyPoolAccount.deserializeFrom(poolData!);
            expect(pool.base_pool.total).toBe(firstStake + secondStake);

            // Verify all tokens were staked
            const finalBalance = await lite.getTokenBalance(BMB_MINT, user.address);
            expect(finalBalance).toBe(0n);
        });

        it('should update checker count on subsequent stakes', async () => {
            const user = await lite.generateKeyPair();
            await lite.airdrop(user, 2);

            const firstStake = bmbToBaseUnits(5000);
            const secondStake = bmbToBaseUnits(2500);
            const totalMint = firstStake + secondStake;

            await lite.mintToken(BMB_MINT, user.address, totalMint, tokenAuthorities.bmbMintAuthority);

            const [userTokenAccount] = await findAssociatedTokenPda({
                mint: BMB_MINT,
                owner: user.address,
                tokenProgram: TOKEN_PROGRAM_ADDRESS
            });

            

            // First stake with 2 checker licenses
            let stake = new Stake({
                user: user.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: firstStake,
                checker_count: 2,
                current_month_period: 5,
                user_token_account: userTokenAccount,
            });

            lite.buildTransaction()
                .addInstruction(await stake.getInstruction())
                .sign(worker)
                .sendTransaction({ payer: user });

            // Verify initial points (min(2, 5000/2500) = 2)
            let [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            let poolData = lite.getAccountData(poolPda);
            let pool = MonthlyPoolAccount.deserializeFrom(poolData!);
            expect(pool.addon_pool.total).toBe(2n);

            // Second stake with 3 checker licenses (bought one more)
            stake = new Stake({
                user: user.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: secondStake,
                checker_count: 3,
                current_month_period: 5,
                user_token_account: userTokenAccount,
            });

            lite.buildTransaction()
                .addInstruction(await stake.getInstruction())
                .sign(worker)
                .sendTransaction({ payer: user });

            // Verify updated points (min(3, 7500/2500) = 3)
            poolData = lite.getAccountData(poolPda);
            pool = MonthlyPoolAccount.deserializeFrom(poolData!);
            expect(pool.addon_pool.total).toBe(3n);

            // Verify position entries
            const [userPositionPda] = await UserStakePositionAccount.findUserStakePositionPDA(user.address, workerCollection);
            const positionData = lite.getAccountData(userPositionPda);
            const position = UserStakePositionAccount.deserializeFrom(positionData!);

            expect(position.stake_entries[0].checker_count).toBe(2);
            expect(position.stake_entries[1].checker_count).toBe(3);
        });

        it('should handle multiple users staking independently', async () => {
            const user1 = await lite.generateKeyPair();
            const user2 = await lite.generateKeyPair();
            await lite.airdrop(user1, 2);
            await lite.airdrop(user2, 2);

            const stake1Amount = bmbToBaseUnits(5000);
            const stake2Amount = bmbToBaseUnits(7500);

            await lite.mintToken(BMB_MINT, user1.address, stake1Amount, tokenAuthorities.bmbMintAuthority);
            await lite.mintToken(BMB_MINT, user2.address, stake2Amount, tokenAuthorities.bmbMintAuthority);

            const [user1TokenAccount] = await findAssociatedTokenPda({
                mint: BMB_MINT,
                owner: user1.address,
                tokenProgram: TOKEN_PROGRAM_ADDRESS
            });

            const [user2TokenAccount] = await findAssociatedTokenPda({
                mint: BMB_MINT,
                owner: user2.address,
                tokenProgram: TOKEN_PROGRAM_ADDRESS
            });

            

            // User 1 stakes
            let stake = new Stake({
                user: user1.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: stake1Amount,
                checker_count: 2,
                current_month_period: 5,
                user_token_account: user1TokenAccount,
            });

            lite.buildTransaction()
                .addInstruction(await stake.getInstruction())
                .sign(worker)
                .sendTransaction({ payer: user1 });

            // User 2 stakes
            stake = new Stake({
                user: user2.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: stake2Amount,
                checker_count: 3,
                current_month_period: 5,
                user_token_account: user2TokenAccount,
            });

            lite.buildTransaction()
                .addInstruction(await stake.getInstruction())
                .sign(worker)
                .sendTransaction({ payer: user2 });

            // Verify user 1 position
            const [user1PositionPda] = await UserStakePositionAccount.findUserStakePositionPDA(user1.address, workerCollection);
            const position1Data = lite.getAccountData(user1PositionPda);
            const position1 = UserStakePositionAccount.deserializeFrom(position1Data!);
            expect(position1.staked_amount).toBe(stake1Amount);

            // Verify user 2 position
            const [user2PositionPda] = await UserStakePositionAccount.findUserStakePositionPDA(user2.address, workerCollection);
            const position2Data = lite.getAccountData(user2PositionPda);
            const position2 = UserStakePositionAccount.deserializeFrom(position2Data!);
            expect(position2.staked_amount).toBe(stake2Amount);

            // Verify pool totals (base: 12500, addon: 2 + 3 = 5 points)
            const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            const poolData = lite.getAccountData(poolPda);
            const pool = MonthlyPoolAccount.deserializeFrom(poolData!);
            expect(pool.base_pool.total).toBe(stake1Amount + stake2Amount);
            expect(pool.addon_pool.total).toBe(5n); // 2 + 3 points

            // Verify config total_staked
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);
            expect(config.total_staked).toBe(stake1Amount + stake2Amount);
        });
    });
});
