import { bmbToBaseUnits, InitializeWorkerStakeConfig, UpdateMinStakeRequirement, WORKER_STAKE_PROGRAM, WorkerStakeConfigAccount } from '@beamable-network/depin';
import { Address, address } from 'gill';
import { beforeEach, describe, expect, it } from 'vitest';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';
import { setupTokens, TokenAuthorities } from '../../helpers/spl-tokens.js';

describe('Worker Stake Config Initialization', async () => {
    let lite: LiteDepin;
    let stakeAdmin: LiteKeyPair;
    let workerCollection: Address;
    let tokenAuthorities: TokenAuthorities;
    let collectionCreator: LiteKeyPair;

    beforeEach(async () => {
        lite = new LiteDepin();

        stakeAdmin = await lite.generateKeyPair();
        await lite.airdrop(stakeAdmin, 10);
        lite.setProgramUpgradeAuthority(WORKER_STAKE_PROGRAM, stakeAdmin.web3PublicKey);

        tokenAuthorities = await setupTokens(lite);

        collectionCreator = await lite.generateKeyPair();
        await lite.airdrop(collectionCreator, 10);
        await lite.createLicenseTree({ creator: collectionCreator });
        workerCollection = address(lite.getCollectionMint()!.publicKey);
    });

    it('should initialize worker stake config with minimum stake', async () => {
        const workerWallet = await lite.generateKeyPair();

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

        // Additional verification: Fetch and inspect the account directly
        const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
        const accountData = lite.getAccountData(configPda);
        expect(accountData).not.toBeNull();

        const workerStakeConfig = WorkerStakeConfigAccount.deserializeFrom(accountData!);

        // Verify initial state
        expect(workerStakeConfig.worker_collection).toBe(workerCollection);
        expect(workerStakeConfig.worker_wallet).toBe(workerWallet.address);
        expect(workerStakeConfig.min_stake_requirement).toBe(bmbToBaseUnits(100)); // 100 BMB
        expect(workerStakeConfig.total_staked).toBe(0n);
        expect(workerStakeConfig.last_active_pool_month).toBe(0);
        expect(workerStakeConfig.active_pools).toEqual([]);
    });

    it('should fail to initialize when not called by upgrade authority', async () => {
        const unauthorizedWallet = await lite.generateKeyPair();
        await lite.airdrop(unauthorizedWallet, 10);

        const workerWallet = await lite.generateKeyPair();

        const initConfig = new InitializeWorkerStakeConfig({
            payer: unauthorizedWallet.address,
            upgrade_authority: unauthorizedWallet.address,
            worker_collection: workerCollection,
            worker_wallet: workerWallet.address,
            min_stake_requirement: bmbToBaseUnits(100), // 100 BMB
        });

        await expect(async () => {
            lite.buildTransaction()
                .addInstruction(await initConfig.getInstruction())
                .sendTransaction({ payer: unauthorizedWallet });
        }).rejects.toThrow("Expected authority does not match program upgrade authority");
    });

    it('should fail to initialize twice for the same worker collection', async () => {
        const workerWallet = await lite.generateKeyPair();

        // First initialization - should succeed
        const initConfig1 = new InitializeWorkerStakeConfig({
            payer: stakeAdmin.address,
            upgrade_authority: stakeAdmin.address,
            worker_collection: workerCollection,
            worker_wallet: workerWallet.address,
            min_stake_requirement: bmbToBaseUnits(100), // 100 BMB
        });

        lite.buildTransaction()
            .addInstruction(await initConfig1.getInstruction())
            .sendTransaction({ payer: stakeAdmin });

        // Second initialization - should fail
        const workerWallet2 = await lite.generateKeyPair();
        const initConfig2 = new InitializeWorkerStakeConfig({
            payer: stakeAdmin.address,
            upgrade_authority: stakeAdmin.address,
            worker_collection: workerCollection,
            worker_wallet: workerWallet2.address,
            min_stake_requirement: bmbToBaseUnits(200), // 200 BMB
        });

        await expect(async () => {
            lite.buildTransaction()
                .addInstruction(await initConfig2.getInstruction())
                .sendTransaction({ payer: stakeAdmin });
        }).rejects.toThrow("WorkerStakeConfig already exists");
    });

    it('should successfully update minimum stake requirement after initialization', async () => {
        const workerWallet = await lite.generateKeyPair();

        // First initialize with 100 BMB requirement
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

        // Verify initial stake requirement
        const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
        let accountData = lite.getAccountData(configPda);
        let workerStakeConfig = WorkerStakeConfigAccount.deserializeFrom(accountData!);
        expect(workerStakeConfig.min_stake_requirement).toBe(bmbToBaseUnits(100));

        // Update to 250 BMB requirement
        const updateMinStake = new UpdateMinStakeRequirement({
            upgrade_authority: stakeAdmin.address,
            worker_collection: workerCollection,
            new_min_stake_requirement: bmbToBaseUnits(250), // 250 BMB
        });

        lite.buildTransaction()
            .addInstruction(await updateMinStake.getInstruction())
            .sendTransaction({ payer: stakeAdmin });

        // Verify updated stake requirement
        accountData = lite.getAccountData(configPda);
        workerStakeConfig = WorkerStakeConfigAccount.deserializeFrom(accountData!);
        expect(workerStakeConfig.min_stake_requirement).toBe(bmbToBaseUnits(250));
        
        // Other fields should remain unchanged
        expect(workerStakeConfig.worker_collection).toBe(workerCollection);
        expect(workerStakeConfig.worker_wallet).toBe(workerWallet.address);
        expect(workerStakeConfig.total_staked).toBe(0n);
    });
});
