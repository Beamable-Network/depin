import {
    BMB_MINT,
    bmbToBaseUnits,
    InitializeWorkerStakeConfig,
    MonthlyPoolAccount,
    MonthlyPoolConfig,
    SetMonthlyPool,
    UpdateWorkerWallet,
    WORKER_STAKE_PROGRAM,
    WorkerStake,
    WorkerStakeConfigAccount,
    WorkerStakeVault,
    WorkerUnstake
} from '@beamable-network/depin';
import { Address, address } from 'gill';
import { beforeEach, describe, expect, it } from 'vitest';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';
import { setupTokens, TokenAuthorities } from '../../helpers/spl-tokens.js';

describe('Worker Instructions', async () => {
    let lite: LiteDepin;
    let stakeAdmin: LiteKeyPair;
    let workerCollection: Address;
    let tokenAuthorities: TokenAuthorities;
    let collectionCreator: LiteKeyPair;
    let workerWallet: LiteKeyPair;

    beforeEach(async () => {
        lite = new LiteDepin();

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
    });

    describe('SetMonthlyPool', () => {
        it('should create a new monthly pool with valid percentages', async () => {
            const pools: MonthlyPoolConfig[] = [{
                month_period: 5, // Future month
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

            // Verify pool was created
            const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 5);
            const poolData = lite.getAccountData(poolPda);
            expect(poolData).not.toBeNull();

            const pool = MonthlyPoolAccount.deserializeFrom(poolData!);
            expect(pool.month_period).toBe(5);
            expect(pool.base_revenue_percentage).toBe(2000);
            expect(pool.addon_revenue_percentage).toBe(1000);
            expect(pool.base_emission_percentage).toBe(1500);
            expect(pool.initialized).toBe(false);

            // Verify active_pools was updated
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);
            expect(config.active_pools).toContain(5);
        });

        it('should create multiple pools in one transaction', async () => {
            const pools: MonthlyPoolConfig[] = [
                {
                    month_period: 5,
                    base_revenue_percentage: 2000,
                    addon_revenue_percentage: 1000,
                    base_emission_percentage: 1500,
                },
                {
                    month_period: 6,
                    base_revenue_percentage: 2500,
                    addon_revenue_percentage: 1500,
                    base_emission_percentage: 2000,
                },
                {
                    month_period: 7,
                    base_revenue_percentage: 3000,
                    addon_revenue_percentage: 2000,
                    base_emission_percentage: 2500,
                }
            ];

            const setPool = new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools,
            });

            lite.buildTransaction()
                .addInstruction(await setPool.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Verify all pools were created
            for (const poolConfig of pools) {
                const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, poolConfig.month_period);
                const poolData = lite.getAccountData(poolPda);
                expect(poolData).not.toBeNull();

                const pool = MonthlyPoolAccount.deserializeFrom(poolData!);
                expect(pool.month_period).toBe(poolConfig.month_period);
                expect(pool.base_revenue_percentage).toBe(poolConfig.base_revenue_percentage);
                expect(pool.addon_revenue_percentage).toBe(poolConfig.addon_revenue_percentage);
                expect(pool.base_emission_percentage).toBe(poolConfig.base_emission_percentage);
            }

            // Verify active_pools array
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);
            expect(config.active_pools).toContain(5);
            expect(config.active_pools).toContain(6);
            expect(config.active_pools).toContain(7);
        });

        it('should fail when base_revenue_percentage exceeds 100%', async () => {
            const pools: MonthlyPoolConfig[] = [{
                month_period: 5,
                base_revenue_percentage: 10001, // > 100%
                addon_revenue_percentage: 1000,
                base_emission_percentage: 1500,
            }];

            const setPool = new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools,
            });

            await expect(async () => {
                lite.buildTransaction()
                    .addInstruction(await setPool.getInstruction())
                    .sendTransaction({ payer: collectionCreator });
            }).rejects.toThrow("base_revenue_percentage cannot exceed");
        });

        it('should fail when addon_revenue_percentage exceeds 100%', async () => {
            const pools: MonthlyPoolConfig[] = [{
                month_period: 5,
                base_revenue_percentage: 2000,
                addon_revenue_percentage: 10001, // > 100%
                base_emission_percentage: 1500,
            }];

            const setPool = new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools,
            });

            await expect(async () => {
                lite.buildTransaction()
                    .addInstruction(await setPool.getInstruction())
                    .sendTransaction({ payer: collectionCreator });
            }).rejects.toThrow("addon_revenue_percentage cannot exceed");
        });

        it('should fail when total revenue percentage exceeds 100%', async () => {
            const pools: MonthlyPoolConfig[] = [{
                month_period: 5,
                base_revenue_percentage: 6000, // 60%
                addon_revenue_percentage: 5000, // 50% (total = 110%)
                base_emission_percentage: 1500,
            }];

            const setPool = new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools,
            });

            await expect(async () => {
                lite.buildTransaction()
                    .addInstruction(await setPool.getInstruction())
                    .sendTransaction({ payer: collectionCreator });
            }).rejects.toThrow("Total revenue percentage");
        });

        it('should fail when base_emission_percentage exceeds 100%', async () => {
            const pools: MonthlyPoolConfig[] = [{
                month_period: 5,
                base_revenue_percentage: 2000,
                addon_revenue_percentage: 1000,
                base_emission_percentage: 10001, // > 100%
            }];

            const setPool = new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools,
            });

            await expect(async () => {
                lite.buildTransaction()
                    .addInstruction(await setPool.getInstruction())
                    .sendTransaction({ payer: collectionCreator });
            }).rejects.toThrow("base_emission_percentage cannot exceed");
        });

        it('should fail when not called by collection authority', async () => {
            const unauthorizedUser = await lite.generateKeyPair();
            await lite.airdrop(unauthorizedUser, 2);

            const pools: MonthlyPoolConfig[] = [{
                month_period: 5,
                base_revenue_percentage: 2000,
                addon_revenue_percentage: 1000,
                base_emission_percentage: 1500,
            }];

            const setPool = new SetMonthlyPool({
                collection_authority: unauthorizedUser.address,
                worker_collection: workerCollection,
                pools,
            });

            await expect(async () => {
                lite.buildTransaction()
                    .addInstruction(await setPool.getInstruction())
                    .sendTransaction({ payer: unauthorizedUser });
            }).rejects.toThrow();
        });

        it('should update existing pool percentages before month starts', async () => {
            // Create initial pool
            const initialPools: MonthlyPoolConfig[] = [{
                month_period: 10,
                base_revenue_percentage: 2000,
                addon_revenue_percentage: 1000,
                base_emission_percentage: 1500,
            }];

            let setPool = new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools: initialPools,
            });

            lite.buildTransaction()
                .addInstruction(await setPool.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Update pool with new percentages
            const updatedPools: MonthlyPoolConfig[] = [{
                month_period: 10,
                base_revenue_percentage: 3000, // Changed
                addon_revenue_percentage: 2000, // Changed
                base_emission_percentage: 2500, // Changed
            }];

            setPool = new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools: updatedPools,
            });

            lite.buildTransaction()
                .addInstruction(await setPool.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Verify pool was updated
            const [poolPda] = await MonthlyPoolAccount.findMonthlyPoolPDA(workerCollection, 10);
            const poolData = lite.getAccountData(poolPda);
            const pool = MonthlyPoolAccount.deserializeFrom(poolData!);

            expect(pool.base_revenue_percentage).toBe(3000);
            expect(pool.addon_revenue_percentage).toBe(2000);
            expect(pool.base_emission_percentage).toBe(2500);
        });
    });

    describe('UpdateWorkerWallet', () => {
        it('should successfully update worker wallet address', async () => {
            const newWallet = await lite.generateKeyPair();

            const updateWallet = new UpdateWorkerWallet({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                new_worker_wallet: newWallet.address,
            });

            lite.buildTransaction()
                .addInstruction(await updateWallet.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Verify wallet was updated
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            expect(config.worker_wallet).toBe(newWallet.address);
        });

        it('should fail when not called by collection authority', async () => {
            const unauthorizedUser = await lite.generateKeyPair();
            await lite.airdrop(unauthorizedUser, 2);
            const newWallet = await lite.generateKeyPair();

            const updateWallet = new UpdateWorkerWallet({
                collection_authority: unauthorizedUser.address,
                worker_collection: workerCollection,
                new_worker_wallet: newWallet.address,
            });

            await expect(async () => {
                lite.buildTransaction()
                    .addInstruction(await updateWallet.getInstruction())
                    .sendTransaction({ payer: unauthorizedUser });
            }).rejects.toThrow();
        });

        it('should allow updating worker wallet multiple times', async () => {
            const wallet1 = await lite.generateKeyPair();
            const wallet2 = await lite.generateKeyPair();
            const wallet3 = await lite.generateKeyPair();

            // First update
            let updateWallet = new UpdateWorkerWallet({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                new_worker_wallet: wallet1.address,
            });

            lite.buildTransaction()
                .addInstruction(await updateWallet.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Second update
            updateWallet = new UpdateWorkerWallet({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                new_worker_wallet: wallet2.address,
            });

            lite.buildTransaction()
                .addInstruction(await updateWallet.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Third update
            updateWallet = new UpdateWorkerWallet({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                new_worker_wallet: wallet3.address,
            });

            lite.buildTransaction()
                .addInstruction(await updateWallet.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Verify final state
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            expect(config.worker_wallet).toBe(wallet3.address);
        });
    });

    describe('WorkerStake', () => {
        it('should successfully stake BMB tokens', async () => {
            const stakeAmount = bmbToBaseUnits(150); // 150 BMB

            // Setup: Mint BMB to collection creator
            await lite.mintToken(BMB_MINT, collectionCreator.address, stakeAmount, tokenAuthorities.bmbMintAuthority);

            // Get initial balance
            const initialBalance = await lite.getTokenBalance(BMB_MINT, collectionCreator.address);
            expect(initialBalance).toBe(stakeAmount);

            const workerStake = new WorkerStake({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                amount: stakeAmount,
            });

            lite.buildTransaction()
                .addInstruction(await workerStake.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Verify stake was recorded
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            expect(config.total_staked).toBe(stakeAmount);

            // Verify tokens were transferred from worker
            const finalBalance = await lite.getTokenBalance(BMB_MINT, collectionCreator.address);
            const stakeVault = await WorkerStakeVault.findWorkerStakeVaultPda(workerCollection);
            const vaultBalance = await lite.getTokenBalance(BMB_MINT, stakeVault[0]);
            expect(vaultBalance).toBe(stakeAmount);
            expect(finalBalance).toBe(0n);
        });

        it('should allow staking multiple times', async () => {
            const firstStake = bmbToBaseUnits(100);
            const secondStake = bmbToBaseUnits(50);
            const totalMint = firstStake + secondStake;

            // Setup: Mint BMB to collection creator
            await lite.mintToken(BMB_MINT, collectionCreator.address, totalMint, tokenAuthorities.bmbMintAuthority);

            // First stake
            let workerStake = new WorkerStake({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                amount: firstStake,
            });

            lite.buildTransaction()
                .addInstruction(await workerStake.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Verify balance after first stake
            let balance = await lite.getTokenBalance(BMB_MINT, collectionCreator.address);
            expect(balance).toBe(secondStake);

            // Second stake
            workerStake = new WorkerStake({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                amount: secondStake,
            });

            lite.buildTransaction()
                .addInstruction(await workerStake.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Verify total stake
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            expect(config.total_staked).toBe(firstStake + secondStake);

            // Verify all tokens were staked
            balance = await lite.getTokenBalance(BMB_MINT, collectionCreator.address);
            const stakeVault = await WorkerStakeVault.findWorkerStakeVaultPda(workerCollection);
            const vaultBalance = await lite.getTokenBalance(BMB_MINT, stakeVault[0]);
            expect(vaultBalance).toBe(firstStake + secondStake);
            expect(balance).toBe(0n);
        });

        it('should fail when staking zero amount', async () => {
            const workerStake = new WorkerStake({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                amount: 0n,
            });

            await expect(async () => {
                lite.buildTransaction()
                    .addInstruction(await workerStake.getInstruction())
                    .sendTransaction({ payer: collectionCreator });
            }).rejects.toThrow("Amount must be greater than 0");
        });

        it('should fail when not called by collection authority', async () => {
            const unauthorizedUser = await lite.generateKeyPair();
            await lite.airdrop(unauthorizedUser, 2);

            const workerStake = new WorkerStake({
                collection_authority: unauthorizedUser.address,
                worker_collection: workerCollection,
                amount: bmbToBaseUnits(100),
            });

            await expect(async () => {
                lite.buildTransaction()
                    .addInstruction(await workerStake.getInstruction())
                    .sendTransaction({ payer: unauthorizedUser });
            }).rejects.toThrow();
        });
    });

    describe('WorkerUnstake', () => {
        beforeEach(async () => {
            // Setup: Stake some BMB first
            const stakeAmount = bmbToBaseUnits(200); // 200 BMB (above min requirement of 100)
            await lite.mintToken(BMB_MINT, collectionCreator.address, stakeAmount, tokenAuthorities.bmbMintAuthority);

            const workerStake = new WorkerStake({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                amount: stakeAmount,
            });

            lite.buildTransaction()
                .addInstruction(await workerStake.getInstruction())
                .sendTransaction({ payer: collectionCreator });
        });

        it('should successfully unstake BMB while maintaining minimum requirement', async () => {
            const unstakeAmount = bmbToBaseUnits(50); // Unstake 50, leaving 150 (above min of 100)

            // Verify initial balance is 0 (all staked)
            let balance = await lite.getTokenBalance(BMB_MINT, collectionCreator.address);
            const stakeVault = await WorkerStakeVault.findWorkerStakeVaultPda(workerCollection);
            let vaultBalance = await lite.getTokenBalance(BMB_MINT, stakeVault[0]);
            expect(balance).toBe(0n);
            expect(vaultBalance).toBe(bmbToBaseUnits(200));

            const workerUnstake = new WorkerUnstake({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                amount: unstakeAmount,
            });

            lite.buildTransaction()
                .addInstruction(await workerUnstake.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Verify unstake was recorded
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            expect(config.total_staked).toBe(bmbToBaseUnits(150));

            // Verify tokens were returned to worker
            balance = await lite.getTokenBalance(BMB_MINT, collectionCreator.address);
            vaultBalance = await lite.getTokenBalance(BMB_MINT, stakeVault[0]);
            expect(vaultBalance).toBe(bmbToBaseUnits(150));
            expect(balance).toBe(unstakeAmount);
        });

        it('should be able to unstake full staked amount', async () => {
            let balance = await lite.getTokenBalance(BMB_MINT, collectionCreator.address);
            expect(balance).toBe(0n);

            const unstakeAmount = bmbToBaseUnits(200);

            const workerUnstake = new WorkerUnstake({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                amount: unstakeAmount,
            });

            lite.buildTransaction()
                .addInstruction(await workerUnstake.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            balance = await lite.getTokenBalance(BMB_MINT, collectionCreator.address);
            expect(balance).toBe(unstakeAmount);
        });

        it('should fail when unstaking zero amount', async () => {
            const workerUnstake = new WorkerUnstake({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                amount: 0n,
            });

            await expect(async () => {
                lite.buildTransaction()
                    .addInstruction(await workerUnstake.getInstruction())
                    .sendTransaction({ payer: collectionCreator });
            }).rejects.toThrow("Amount must be greater than 0");
        });

        it('should fail when not called by collection authority', async () => {
            const unauthorizedUser = await lite.generateKeyPair();
            await lite.airdrop(unauthorizedUser, 2);

            const workerUnstake = new WorkerUnstake({
                collection_authority: unauthorizedUser.address,
                worker_collection: workerCollection,
                amount: bmbToBaseUnits(50),
            });

            await expect(async () => {
                lite.buildTransaction()
                    .addInstruction(await workerUnstake.getInstruction())
                    .sendTransaction({ payer: unauthorizedUser });
            }).rejects.toThrow();
        });

        it('should allow unstaking to exactly the minimum requirement', async () => {
            const unstakeAmount = bmbToBaseUnits(100); // Unstake 100, leaving exactly 100 (min requirement)

            const workerUnstake = new WorkerUnstake({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                amount: unstakeAmount,
            });

            lite.buildTransaction()
                .addInstruction(await workerUnstake.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Verify stake equals minimum requirement
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            expect(config.total_staked).toBe(bmbToBaseUnits(100));
        });

        it('should handle multiple unstake operations', async () => {
            const firstUnstake = bmbToBaseUnits(30);
            const secondUnstake = bmbToBaseUnits(20);

            // First unstake
            let workerUnstake = new WorkerUnstake({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                amount: firstUnstake,
            });

            lite.buildTransaction()
                .addInstruction(await workerUnstake.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Verify balance after first unstake
            let balance = await lite.getTokenBalance(BMB_MINT, collectionCreator.address);
            expect(balance).toBe(firstUnstake);

            // Second unstake
            workerUnstake = new WorkerUnstake({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                amount: secondUnstake,
            });

            lite.buildTransaction()
                .addInstruction(await workerUnstake.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Verify final stake (200 - 30 - 20 = 150)
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            expect(config.total_staked).toBe(bmbToBaseUnits(150));

            // Verify final balance
            balance = await lite.getTokenBalance(BMB_MINT, collectionCreator.address);
            expect(balance).toBe(firstUnstake + secondUnstake);
        });
    });

    describe('Combined Worker Operations', () => {
        it('should handle stake, unstake, and wallet update in sequence', async () => {
            // Stake
            const stakeAmount = bmbToBaseUnits(250);
            await lite.mintToken(BMB_MINT, collectionCreator.address, stakeAmount, tokenAuthorities.bmbMintAuthority);

            const workerStake = new WorkerStake({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                amount: stakeAmount,
            });

            lite.buildTransaction()
                .addInstruction(await workerStake.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Verify stake and balance
            let balance = await lite.getTokenBalance(BMB_MINT, collectionCreator.address);
            expect(balance).toBe(0n);

            // Update wallet
            const newWallet = await lite.generateKeyPair();
            const updateWallet = new UpdateWorkerWallet({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                new_worker_wallet: newWallet.address,
            });

            lite.buildTransaction()
                .addInstruction(await updateWallet.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Unstake
            const unstakeAmount = bmbToBaseUnits(100);
            const workerUnstake = new WorkerUnstake({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                amount: unstakeAmount,
            });

            lite.buildTransaction()
                .addInstruction(await workerUnstake.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Verify final state
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            expect(config.total_staked).toBe(bmbToBaseUnits(150));
            expect(config.worker_wallet).toBe(newWallet.address);

            // Verify final balance
            balance = await lite.getTokenBalance(BMB_MINT, collectionCreator.address);
            expect(balance).toBe(unstakeAmount);
        });

        it('should handle setting pools and staking in same scenario', async () => {
            // Set monthly pools
            const pools: MonthlyPoolConfig[] = [
                {
                    month_period: 5,
                    base_revenue_percentage: 2000,
                    addon_revenue_percentage: 1000,
                    base_emission_percentage: 1500,
                },
                {
                    month_period: 6,
                    base_revenue_percentage: 2500,
                    addon_revenue_percentage: 1500,
                    base_emission_percentage: 2000,
                }
            ];

            const setPool = new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools,
            });

            lite.buildTransaction()
                .addInstruction(await setPool.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Worker stakes
            const stakeAmount = bmbToBaseUnits(300);
            await lite.mintToken(BMB_MINT, collectionCreator.address, stakeAmount, tokenAuthorities.bmbMintAuthority);

            const workerStake = new WorkerStake({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                amount: stakeAmount,
            });

            lite.buildTransaction()
                .addInstruction(await workerStake.getInstruction())
                .sendTransaction({ payer: collectionCreator });

            // Verify both pools exist and stake is recorded
            const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
            const configData = lite.getAccountData(configPda);
            const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

            expect(config.total_staked).toBe(stakeAmount);
            expect(config.active_pools).toContain(5);
            expect(config.active_pools).toContain(6);
        });
    });
});
