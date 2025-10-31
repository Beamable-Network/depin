import {
    bmbToBaseUnits,
    InitializeWorkerStakeConfig,
    SetMonthlyPool,
    Stake,
    Unstake,
    Withdraw,
    ClaimRewards,
    MonthlyPoolConfig,
    WorkerStakeConfigAccount,
    MonthlyPoolAccount,
    UserStakePositionAccount,
    WORKER_STAKE_PROGRAM,
    BMB_MINT,
    USDC_MINT
} from '@beamable-network/depin';
import { Address, address } from 'gill';
import { beforeEach, describe, expect, it } from 'vitest';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';
import { setupTokens, TokenAuthorities } from '../../helpers/spl-tokens.js';
import { AssetWithProof } from '@metaplex-foundation/mpl-bubblegum';

describe('User Unstake and Withdraw Instructions', async () => {
    let lite: LiteDepin;
    let stakeAdmin: LiteKeyPair;
    let workerCollection: Address;
    let tokenAuthorities: TokenAuthorities;
    let collectionCreator: LiteKeyPair;
    let workerWallet: LiteKeyPair;
    let worker: LiteKeyPair;
    let workerLicense: AssetWithProof;

    // Helper to create a staked user
    async function createStakedUser(
        stakeAmount: bigint,
        checkerCount: number,
        monthPeriod: number
    ): Promise<{ user: LiteKeyPair }> {
        const user = await lite.generateKeyPair();
        await lite.airdrop(user, 2);

        await lite.mintToken(BMB_MINT, user.address, stakeAmount, tokenAuthorities.bmbMintAuthority);

        const stake = new Stake({
            user: user.address,
            worker: worker.address,
            worker_license: workerLicense,
            worker_collection: workerCollection,
            amount: stakeAmount,
            checker_count: checkerCount,
            current_month_period: monthPeriod,
        });

        lite.buildTransaction()
            .addInstruction(await stake.getInstruction())
            .sign(worker)
            .sendTransaction({ payer: user });

        return { user };
    }

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
            min_stake_requirement: bmbToBaseUnits(100),
        });

        lite.buildTransaction()
            .addInstruction(await initConfig.getInstruction())
            .sendTransaction({ payer: stakeAdmin });

        // Create a monthly pool for current month (month_period: 5)
        const pools: MonthlyPoolConfig[] = [{
            month_period: 5,
            base_revenue_percentage: 2000,
            addon_revenue_percentage: 1000,
            base_emission_percentage: 1500,
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

    describe('Unstake', () => {
        it('should successfully opt out when active pool exists', async () => {
            const { user } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            // Get config to read last_active_pool_month
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            let configData = lite.getAccountData(configPda);
            let config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            const unstake = new Unstake({
                user: user.address,
                worker_collection: workerCollection,
                last_active_pool_month_period: config.last_active_pool_month,
            });

            lite.buildTransaction()
                .addInstruction(await unstake.getInstruction())
                .sendTransaction({ payer: user });

            // Verify opted_out_at_month_period was set
            const [userPositionPda] = await UserStakePositionAccount.findUserStakePositionPDA(user.address, workerCollection);
            const positionData = lite.getAccountData(userPositionPda);
            const position = UserStakePositionAccount.deserializeFrom(positionData!);

            // Should be set to current_month + 1 (user can withdraw after current month ends)
            expect(position.opted_out_at_month_period).toBe(6); // 5 + 1

            // Verify pool's total_opted_out was updated
            const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            const poolData = lite.getAccountData(poolPda);
            const pool = MonthlyPoolAccount.deserializeFrom(poolData!);

            expect(pool.base_pool.total_opted_out).toBe(bmbToBaseUnits(5000));
            expect(pool.addon_pool.total_opted_out).toBe(0n); // No checker licenses
        });

        it('should update addon pool opted-out when user has checker licenses', async () => {
            const { user } = await createStakedUser(bmbToBaseUnits(7500), 3, 5);

            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            const unstake = new Unstake({
                user: user.address,
                worker_collection: workerCollection,
                last_active_pool_month_period: config.last_active_pool_month,
            });

            lite.buildTransaction()
                .addInstruction(await unstake.getInstruction())
                .sendTransaction({ payer: user });

            // Verify addon pool opted-out (3 points)
            const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            const poolData = lite.getAccountData(poolPda);
            const pool = MonthlyPoolAccount.deserializeFrom(poolData!);

            expect(pool.addon_pool.total_opted_out).toBe(3n); // 3 points
        });

        it('should fail when trying to unstake twice', async () => {
            const { user } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            const unstake = new Unstake({
                user: user.address,
                worker_collection: workerCollection,
                last_active_pool_month_period: config.last_active_pool_month,
            });

            // First unstake - should succeed
            lite.buildTransaction()
                .addInstruction(await unstake.getInstruction())
                .sendTransaction({ payer: user });

            // Second unstake - should fail
            await expect(async () => {
                lite.buildTransaction()
                    .addInstruction(await unstake.getInstruction())
                    .sendTransaction({ payer: user });
            }).rejects.toThrow();
        });

        it('should handle multiple users unstaking independently', async () => {
            const { user: user1 } = await createStakedUser(bmbToBaseUnits(5000), 2, 5);
            const { user: user2 } = await createStakedUser(bmbToBaseUnits(7500), 3, 5);

            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            // User 1 unstakes
            let unstake = new Unstake({
                user: user1.address,
                worker_collection: workerCollection,
                last_active_pool_month_period: config.last_active_pool_month,
            });

            lite.buildTransaction()
                .addInstruction(await unstake.getInstruction())
                .sendTransaction({ payer: user1 });

            // User 2 unstakes
            unstake = new Unstake({
                user: user2.address,
                worker_collection: workerCollection,
                last_active_pool_month_period: config.last_active_pool_month,
            });

            lite.buildTransaction()
                .addInstruction(await unstake.getInstruction())
                .sendTransaction({ payer: user2 });

            // Verify pool opted-out totals
            const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            const poolData = lite.getAccountData(poolPda);
            const pool = MonthlyPoolAccount.deserializeFrom(poolData!);

            expect(pool.base_pool.total_opted_out).toBe(bmbToBaseUnits(12500)); // 5000 + 7500
            expect(pool.addon_pool.total_opted_out).toBe(5n); // 2 + 3 points
        });
    });

    describe('Withdraw', () => {
        it('should successfully withdraw after unstaking and waiting', async () => {
            const stakeAmount = bmbToBaseUnits(5000);
            const { user } = await createStakedUser(stakeAmount, 0, 5);

            // Get initial balance (should be 0 after staking)
            let balance = await lite.getTokenBalance(BMB_MINT, user.address);
            expect(balance).toBe(0n);

            // Unstake
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            let configData = lite.getAccountData(configPda);
            let config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            const unstake = new Unstake({
                user: user.address,
                worker_collection: workerCollection,
                last_active_pool_month_period: config.last_active_pool_month,
            });

            lite.buildTransaction()
                .addInstruction(await unstake.getInstruction())
                .sendTransaction({ payer: user });

            // Advance to month 6 to allow withdrawal
            lite.goToMonthPeriod(6);

            // Claim month 5 rewards before withdrawing (even though no rewards were deposited)
            const claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // Withdraw
            const withdraw = new Withdraw({
                user: user.address,
                worker_collection: workerCollection,
            });

            lite.buildTransaction()
                .addInstruction(await withdraw.getInstruction())
                .sendTransaction({ payer: user });

            // Verify tokens were returned
            balance = await lite.getTokenBalance(BMB_MINT, user.address);
            expect(balance).toBe(stakeAmount);

            // Verify user position was closed
            const [userPositionPda] = await UserStakePositionAccount.findUserStakePositionPDA(user.address, workerCollection);
            const positionData = lite.getAccountData(userPositionPda);
            expect(positionData).toBeNull();

            // Verify config total_staked was reduced
            configData = lite.getAccountData(configPda);
            config = WorkerStakeConfigAccount.deserializeFrom(configData!);
            expect(config.total_staked).toBe(0n);
        });

        it('should fail when trying to withdraw without unstaking first', async () => {
            const { user } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            const withdraw = new Withdraw({
                user: user.address,
                worker_collection: workerCollection,
            });

            await expect(async () => {
                lite.buildTransaction()
                    .addInstruction(await withdraw.getInstruction())
                    .sendTransaction({ payer: user });
            }).rejects.toThrow();
        });

        it('should fail when trying to withdraw before waiting period ends', async () => {
            const { user } = await createStakedUser(bmbToBaseUnits(5000), 0, 5);

            // Unstake
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            const unstake = new Unstake({
                user: user.address,
                worker_collection: workerCollection,
                last_active_pool_month_period: config.last_active_pool_month,
            });

            lite.buildTransaction()
                .addInstruction(await unstake.getInstruction())
                .sendTransaction({ payer: user });

            // Try to withdraw immediately (without advancing to next month)
            const withdraw = new Withdraw({
                user: user.address,
                worker_collection: workerCollection,
            });

            await expect(async () => {
                lite.buildTransaction()
                    .addInstruction(await withdraw.getInstruction())
                    .sendTransaction({ payer: user });
            }).rejects.toThrow();
        });

        it('should allow immediate withdrawal after unstaking when no active pool exists', async () => {
            // Scenario: User stakes in month 5, then we advance to month 6 without creating a pool
            // User unstakes in month 6 (no active pool), should be able to withdraw immediately
            const stakeAmount = bmbToBaseUnits(5000);
            const { user } = await createStakedUser(stakeAmount, 0, 5);

            // Advance to month 6 without creating a pool for month 6
            lite.goToMonthPeriod(6);

            // Get config
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            // Unstake (no active pool in month 6)
            const unstake = new Unstake({
                user: user.address,
                worker_collection: workerCollection,
                last_active_pool_month_period: config.last_active_pool_month,
            });

            lite.buildTransaction()
                .addInstruction(await unstake.getInstruction())
                .sendTransaction({ payer: user });

            // Claim month 5 rewards before withdrawing
            const claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // Should be able to withdraw immediately (no waiting period since no active pool)
            const withdraw = new Withdraw({
                user: user.address,
                worker_collection: workerCollection,
            });

            lite.buildTransaction()
                .addInstruction(await withdraw.getInstruction())
                .sendTransaction({ payer: user });

            // Verify BMB was returned
            const finalBalance = await lite.getTokenBalance(BMB_MINT, user.address);
            expect(finalBalance).toBe(stakeAmount);

            // Verify position account was closed
            const [userPositionPda] = await UserStakePositionAccount.findUserStakePositionPDA(user.address, workerCollection);
            const positionData = lite.getAccountData(userPositionPda);
            expect(positionData).toBeNull();
        });

        it('should handle multiple users withdrawing independently', async () => {
            const stake1Amount = bmbToBaseUnits(5000);
            const stake2Amount = bmbToBaseUnits(7500);

            const { user: user1 } =
                await createStakedUser(stake1Amount, 0, 5);
            const { user: user2 } =
                await createStakedUser(stake2Amount, 3, 5);

            // Get config
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            let configData = lite.getAccountData(configPda);
            let config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            // Both users unstake
            let unstake = new Unstake({
                user: user1.address,
                worker_collection: workerCollection,
                last_active_pool_month_period: config.last_active_pool_month,
            });

            lite.buildTransaction()
                .addInstruction(await unstake.getInstruction())
                .sendTransaction({ payer: user1 });

            unstake = new Unstake({
                user: user2.address,
                worker_collection: workerCollection,
                last_active_pool_month_period: config.last_active_pool_month,
            });

            lite.buildTransaction()
                .addInstruction(await unstake.getInstruction())
                .sendTransaction({ payer: user2 });

            // Advance to month 6 to allow withdrawal
            lite.goToMonthPeriod(6);

            // Both users claim month 5 rewards before withdrawing
            let claimRewards = new ClaimRewards({
                user: user1.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user1 });

            claimRewards = new ClaimRewards({
                user: user2.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user2 });

            // Both users withdraw
            let withdraw = new Withdraw({
                user: user1.address,
                worker_collection: workerCollection,
            });

            lite.buildTransaction()
                .addInstruction(await withdraw.getInstruction())
                .sendTransaction({ payer: user1 });

            withdraw = new Withdraw({
                user: user2.address,
                worker_collection: workerCollection,
            });

            lite.buildTransaction()
                .addInstruction(await withdraw.getInstruction())
                .sendTransaction({ payer: user2 });

            // Verify both got their tokens back
            const balance1 = await lite.getTokenBalance(BMB_MINT, user1.address);
            const balance2 = await lite.getTokenBalance(BMB_MINT, user2.address);
            expect(balance1).toBe(stake1Amount);
            expect(balance2).toBe(stake2Amount);

            // Verify config total_staked is back to 0
            configData = lite.getAccountData(configPda);
            config = WorkerStakeConfigAccount.deserializeFrom(configData!);
            expect(config.total_staked).toBe(0n);
        });
    });

    describe('Unstake and Withdraw Flow', () => {
        it('should complete full unstake-wait-withdraw lifecycle', async () => {
            const stakeAmount = bmbToBaseUnits(10000);
            const { user } = await createStakedUser(stakeAmount, 4, 5);

            // Verify initial state
            let [userPositionPda] = await UserStakePositionAccount.findUserStakePositionPDA(user.address, workerCollection);
            let positionData = lite.getAccountData(userPositionPda);
            let position = UserStakePositionAccount.deserializeFrom(positionData!);
            expect(position.staked_amount).toBe(stakeAmount);
            expect(position.opted_out_at_month_period).toBe(0);

            // Unstake
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            let configData = lite.getAccountData(configPda);
            let config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            const unstake = new Unstake({
                user: user.address,
                worker_collection: workerCollection,
                last_active_pool_month_period: config.last_active_pool_month,
            });

            lite.buildTransaction()
                .addInstruction(await unstake.getInstruction())
                .sendTransaction({ payer: user });

            // Verify opted out
            positionData = lite.getAccountData(userPositionPda);
            position = UserStakePositionAccount.deserializeFrom(positionData!);
            expect(position.opted_out_at_month_period).toBe(6);

            // Verify pool opted-out updated
            const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            const poolData = lite.getAccountData(poolPda);
            const pool = MonthlyPoolAccount.deserializeFrom(poolData!);
            expect(pool.base_pool.total_opted_out).toBe(stakeAmount);
            expect(pool.addon_pool.total_opted_out).toBe(4n); // 4 points

            // Advance to month 6 to allow withdrawal
            lite.goToMonthPeriod(6);

            // Claim month 5 rewards before withdrawing
            const claimRewards = new ClaimRewards({
                user: user.address,
                worker_collection: workerCollection,
                month_period: 5,
            });

            lite.buildTransaction()
                .addInstruction(await claimRewards.getInstruction())
                .sendTransaction({ payer: user });

            // Withdraw
            const withdraw = new Withdraw({
                user: user.address,
                worker_collection: workerCollection,
            });

            lite.buildTransaction()
                .addInstruction(await withdraw.getInstruction())
                .sendTransaction({ payer: user });

            // Verify final state
            const balance = await lite.getTokenBalance(BMB_MINT, user.address);
            expect(balance).toBe(stakeAmount);

            const finalPositionData = lite.getAccountData(userPositionPda);
            expect(finalPositionData).toBeNull();

            configData = lite.getAccountData(configPda);
            config = WorkerStakeConfigAccount.deserializeFrom(configData!);
            expect(config.total_staked).toBe(0n);
        });
    });
});
