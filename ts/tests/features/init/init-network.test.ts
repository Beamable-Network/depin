import { describe, expect, it } from 'vitest';

import { BMB_MINT, GlobalRewardsAccount, InitNetwork, TreasuryAuthority, TreasuryStateAccount, TreasuryConfigAccount } from 'beamable-network-depin';
import { initializeNetwork } from '../../helpers/bmb-utils.js';
import { LiteDepin } from '../../helpers/lite-depin.js';

describe('Init network', async () => {
    const lite = new LiteDepin();
    const signer = await lite.generateKeyPair();
    await lite.airdrop(signer, 10);

    // Initialize BMB mint and treasury with some tokens
    await lite.createToken(BMB_MINT, signer);
    const [treasury] = await TreasuryAuthority.findTreasuryPDA();
    await lite.mintToken(BMB_MINT, treasury, BigInt(10_000_000_000), signer);

    it('should have treasury balance', async () => {
        const treasuryBalance = await lite.getTokenBalance(BMB_MINT, treasury);
        expect(treasuryBalance).toEqual(BigInt(10_000_000_000n));
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
            log.includes("Initialization done") ||
            log.includes("TreasuryState already exists")
        );
        expect(hasIdempotentMessage).toBe(true);

        // Verify accounts are still in correct state after second call
        await verifyNetworkInitialization(lite);
    });
});



async function verifyNetworkInitialization(lite: LiteDepin): Promise<void> {
    await verifyGlobalRewardsAccount(lite);
    await verifyTreasuryStateAccount(lite);
    await verifyTreasuryConfigAccount(lite);
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

async function verifyTreasuryStateAccount(lite: LiteDepin): Promise<void> {
    const treasuryStatePDA = await TreasuryStateAccount.findTreasuryStatePDA();
    const treasuryStateData = lite.getAccountData(treasuryStatePDA[0]);
    expect(treasuryStateData).not.toBeNull();
    expect(treasuryStateData!.length).toBeGreaterThan(0);

    const treasuryState = TreasuryStateAccount.deserializeFrom(treasuryStateData);
    expect(treasuryState.lockedBalance).toBe(0n);
}

async function verifyTreasuryConfigAccount(lite: LiteDepin): Promise<void> {
    const treasuryConfigPDA = await TreasuryConfigAccount.findTreasuryConfigPDA();
    const treasuryConfigData = lite.getAccountData(treasuryConfigPDA[0]);
    expect(treasuryConfigData).not.toBeNull();
    expect(treasuryConfigData!.length).toBeGreaterThan(0);

    const treasuryConfig = TreasuryConfigAccount.deserializeFrom(treasuryConfigData!);
    expect(treasuryConfig.checkerRewardsLockDays).toBe(365);
}
