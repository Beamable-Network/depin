import { describe, expect, it } from 'vitest';

import { BMB_MINT, GlobalRewardsAccount, InitNetwork, DEPIN_PROGRAM, CheckerRewardsVault } from '@beamable-network/depin';
import { initializeNetwork } from '../../helpers/bmb-utils.js';
import { LiteDepin } from '../../helpers/lite-depin.js';

describe('Init network', async () => {
    const lite = new LiteDepin();
    const signer = await lite.generateKeyPair();
    await lite.airdrop(signer, 10);
    lite.setProgramUpgradeAuthority(DEPIN_PROGRAM, signer.web3PublicKey);

    // Initialize BMB mint and CheckerRewardsVault with some tokens
    await lite.createToken(BMB_MINT, signer);
    const [checkerRewardsVault] = await CheckerRewardsVault.findPDA();
    await lite.mintToken(BMB_MINT, checkerRewardsVault, BigInt(10_000_000_000), signer);

    it('should have CheckerRewardsVault balance', async () => {
        const vaultBalance = await lite.getTokenBalance(BMB_MINT, checkerRewardsVault);
        expect(vaultBalance).toEqual(BigInt(10_000_000_000n));
    });

    it('should be able to init network with progressive resizing', async () => {
        const callCount = await initializeNetwork({ lite, signer });
        console.log(`Network initialization completed in ${callCount} calls`);

        // Verify all accounts were created properly
        await verifyNetworkInitialization(lite);
    });

    it('should handle multiple initialization calls gracefully (idempotency)', async () => {
        // First initialization - should complete normally
        const firstCallCount = await initializeNetwork({ lite, signer });
        console.log(`First initialization completed in ${firstCallCount} calls`);

        // Verify initialization was successful
        await verifyNetworkInitialization(lite);

        // Second initialization - should handle already existing accounts gracefully
        const secondInitInput = new InitNetwork(signer.address);
        const secondResult = await lite.buildTransaction()
            .addInstruction(await secondInitInput.getInstruction())
            .sendTransaction({ payer: signer });

        console.log('Second init call logs:', secondResult.logs);

        // Should complete without errors and show that accounts already exist
        expect(secondResult.logs).toBeDefined();

        // Check for expected idempotent behavior messages
        const hasIdempotentMessage = secondResult.logs?.some(log =>
            log.includes("Initialization done")
        );
        expect(hasIdempotentMessage).toBe(true);

        // Verify accounts are still in correct state after second call
        await verifyNetworkInitialization(lite);
    });
});



async function verifyNetworkInitialization(lite: LiteDepin): Promise<void> {
    await verifyGlobalRewardsAccount(lite);
    await verifyCheckerRewardsVault(lite);
    console.log("All network initialization accounts verified successfully");
}

async function verifyGlobalRewardsAccount(lite: LiteDepin): Promise<void> {
    const globalRewardsPDA = await GlobalRewardsAccount.findGlobalRewardsPDA();
    const globalRewardsData = lite.getAccountData(globalRewardsPDA[0]);
    expect(globalRewardsData).not.toBeNull();
    expect(globalRewardsData!.length).toBeGreaterThan(0);

    const globalRewards = GlobalRewardsAccount.deserializeFrom(globalRewardsData);
    expect(globalRewards.checkers.length).toBe(100_000);
}

async function verifyCheckerRewardsVault(lite: LiteDepin): Promise<void> {
    const vaultPda = await CheckerRewardsVault.findPDA();
    const vaultData = lite.getAccountData(vaultPda[0]);
    expect(vaultData).not.toBeNull();
    expect(vaultData!.length).toBeGreaterThan(0);

    const vault = CheckerRewardsVault.deserializeFrom(vaultData!);
    expect(vault.lockDays).toBe(90);
}
