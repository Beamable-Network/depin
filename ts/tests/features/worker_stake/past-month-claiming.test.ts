import {
    BMB_MINT,
    bmbToBaseUnits,
    ClaimRewards,
    DepositRevenue,
    InitializeWorkerStakeConfig,
    MonthlyPoolConfig,
    SetMonthlyPool,
    Stake,
    USDC_MINT,
    WORKER_STAKE_PROGRAM,
    WorkerStakeConfigAccount
} from '@beamable-network/depin';
import { AssetWithProof } from '@metaplex-foundation/mpl-bubblegum';
import { Address, address } from 'gill';
import { beforeEach, describe, expect, it } from 'vitest';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';
import { setupTokens, TokenAuthorities, usdcToBaseUnits } from '../../helpers/spl-tokens.js';

describe('Past Month Claiming', async () => {
    let lite: LiteDepin;
    let stakeAdmin: LiteKeyPair;
    let workerCollection: Address;
    let tokenAuthorities: TokenAuthorities;
    let collectionCreator: LiteKeyPair;
    let workerWallet: LiteKeyPair;
    let worker: LiteKeyPair;
    let workerLicense: AssetWithProof;
    let revenueSource: LiteKeyPair;

    // Helper to deposit revenue
    async function depositRevenue(amount: bigint, monthPeriod: number) {
        const [configPda] = await WorkerStakeConfigAccount.findWorkerStakeConfigPDA(workerCollection);
        const configData = lite.getAccountData(configPda);
        const config = WorkerStakeConfigAccount.deserializeFrom(configData!);

        const depositRev = new DepositRevenue({
            revenue_source: revenueSource.address,
            worker_collection: workerCollection,
            worker_wallet: workerWallet.address,
            total_revenue: amount,
            current_month_period: monthPeriod,
            has_monthly_pool: true,
        });

        if (config.last_active_pool_month > 0) {
            depositRev.previous_pool_month_period = config.last_active_pool_month;
        }

        lite.buildTransaction()
            .addInstruction(await depositRev.getInstruction())
            .sendTransaction({ payer: revenueSource });
    }

    beforeEach(async () => {
        lite = new LiteDepin();

        // Set clock to month 5
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

        // Setup revenue source
        revenueSource = await lite.generateKeyPair();
        await lite.airdrop(revenueSource, 10);

        // Initialize worker stake config
        const initConfig = new InitializeWorkerStakeConfig({
            payer: stakeAdmin.address,
            upgrade_authority: stakeAdmin.address,
            worker_collection: workerCollection,
            worker_wallet: workerWallet.address,
            min_stake_requirement: bmbToBaseUnits(100),
        });

        await lite.buildTransaction()
            .addInstruction(await initConfig.getInstruction())
            .sendTransaction({ payer: stakeAdmin });
    });

    it('should allow claiming for past month after creating new pool', async () => {
        // 1. Create a monthly pool for month 5
        const month5Pools: MonthlyPoolConfig[] = [{
            month_period: 5,
            base_revenue_percentage: 2000, // 20%
            addon_revenue_percentage: 1000, // 10%
            base_emission_percentage: 1500, // 15%
        }];

        await lite.buildTransaction()
            .addInstruction(await (new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools: month5Pools,
            })).getInstruction())
            .sendTransaction({ payer: collectionCreator });

        // 2. User stakes in month 5
        const user = await lite.generateKeyPair();
        await lite.airdrop(user, 2);
        await lite.mintToken(BMB_MINT, user.address, bmbToBaseUnits(5000), tokenAuthorities.bmbMintAuthority);

        const stake = new Stake({
            user: user.address,
            worker: worker.address,
            worker_license: workerLicense,
            worker_collection: workerCollection,
            amount: bmbToBaseUnits(5000),
            checker_count: 0,
            current_month_period: 5,
        });

        await lite.buildTransaction()
            .addInstruction(await stake.getInstruction())
            .sign(user)
            .sendTransaction({ payer: worker });

        // Deposit revenue for month 5
        const revenueAmount = usdcToBaseUnits(1000);
        await lite.mintToken(USDC_MINT, revenueSource.address, revenueAmount, tokenAuthorities.usdcMintAuthority);
        await depositRevenue(revenueAmount, 5);

        // 3. Go to month 6
        lite.goToMonthPeriod(6);

        // 4. Create a new monthly pool for month 6
        // This will compact active_pools and remove past months
        const month6Pools: MonthlyPoolConfig[] = [{
            month_period: 6,
            base_revenue_percentage: 2000,
            addon_revenue_percentage: 1000,
            base_emission_percentage: 1500,
        }];

        await lite.buildTransaction()
            .addInstruction(await (new SetMonthlyPool({
                collection_authority: collectionCreator.address,
                worker_collection: workerCollection,
                pools: month6Pools,
            })).getInstruction())
            .sendTransaction({ payer: collectionCreator });

        // 5. Claim rewards for month 5 - should succeed even though month 5 was removed from active_pools
        const claimRewards = new ClaimRewards({
            user: user.address,
            worker_collection: workerCollection,
            month_period: 5,
        });

        await lite.buildTransaction()
            .addInstruction(await claimRewards.getInstruction())
            .sendTransaction({ payer: user });

        // User should receive 200 USDC (20% of 1000)
        const usdcBalance = await lite.getTokenBalance(USDC_MINT, user.address);
        expect(usdcBalance).toBe(usdcToBaseUnits(200));
    });
});
