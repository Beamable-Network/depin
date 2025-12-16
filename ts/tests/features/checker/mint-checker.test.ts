import { beforeEach, describe, expect, it } from 'vitest';

import { BMB_DECIMALS, BMB_MINT, BMBStateAccount, bmbToBaseUnits, CheckerLicenseAuthority, DEPIN_PROGRAM, MintChecker } from '@beamable-network/depin';
import { findTreeConfigPda, getLeafSchemaSerializer, getTreeConfigAccountDataSerializer } from '@metaplex-foundation/mpl-bubblegum';
import { publicKey } from '@metaplex-foundation/umi';
import { Address, address } from 'gill';
import { initializeNetwork } from '../../helpers/bmb-utils.js';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';

describe('Checker minting', async () => {
    let lite: LiteDepin;
    let signer: LiteKeyPair;
    let tree: Address;

    beforeEach(async () => {
        lite = new LiteDepin();
        signer = await lite.generateKeyPair();

        const treeCreator = await lite.generateKeyPair();
        const [checkerLicenseAuthorityPda] = await CheckerLicenseAuthority.findPDA();

        await lite.airdrop(signer, 10);
        await lite.airdrop(treeCreator, 10);

        await lite.createToken(BMB_MINT, signer, BMB_DECIMALS);
        await lite.setProgramUpgradeAuthority(DEPIN_PROGRAM, signer.web3PublicKey);
        await lite.createLicenseTree({ creator: treeCreator, delegatedAuthority: checkerLicenseAuthorityPda });

        await initializeNetwork({ lite, signer });

        tree = address(lite.getMerkleTree().publicKey);

        await lite.mintToken(BMB_MINT, signer.address, bmbToBaseUnits(1_000_000), signer); // Mint 1M BMB to signer
    });

    it('should be able to mint a checker', async () => {
        expect(getTreeConfig(tree).numMinted).toBe(0n);

        const mintChecker = new MintChecker({
            minter: signer.address,
            mintReceiver: address("UZAkx8aZ3tnJ6zm446m1MnBGR7dycshvoftaSCRXWVF"),
            merkleTree: tree,
            checkerCollection: address(lite.getCollectionMint().publicKey),
            network: "devnet"
        });

        let txResponse = await lite.buildTransaction()
            .addInstruction(await mintChecker.getInstruction())
            .sendTransaction({ payer: signer });

        let [parsedLeaf] = getLeafSchemaSerializer().deserialize(txResponse.returnData, 0);
        expect(parsedLeaf.owner).toEqual(publicKey(mintChecker.mintReceiver));

        expect(getTreeConfig(tree).numMinted).toBe(1n);

        // Another mint
        txResponse = await lite.buildTransaction()
            .addInstruction(await mintChecker.getInstruction())
            .sendTransaction({ payer: signer });

        [parsedLeaf] = getLeafSchemaSerializer().deserialize(txResponse.returnData, 0);
        expect(parsedLeaf.owner).toEqual(publicKey(mintChecker.mintReceiver));

        expect(getTreeConfig(tree).numMinted).toBe(2n);
    });

    it('should activate checker license in BMBState after minting', async () => {
        lite.goToPeriod(100);

        expect(getTreeConfig(tree).numMinted).toBe(0n);

        const mintChecker = new MintChecker({
            minter: signer.address,
            mintReceiver: address("UZAkx8aZ3tnJ6zm446m1MnBGR7dycshvoftaSCRXWVF"),
            merkleTree: tree,
            checkerCollection: address(lite.getCollectionMint().publicKey),
            network: "devnet",
        });

        const stateAccountPda = await BMBStateAccount.findPDA();
        let stateAccount = BMBStateAccount.deserializeFrom(lite.getAccountData(stateAccountPda[0])!);

        expect(stateAccount.period_checkers_buffer.buffer.find(e => e > 0)).toBeUndefined();

        await lite.buildTransaction()
            .addInstruction(await mintChecker.getInstruction())
            .sendTransaction({ payer: signer });

        expect(getTreeConfig(tree).numMinted).toBe(1n);

        stateAccount = BMBStateAccount.deserializeFrom(lite.getAccountData(stateAccountPda[0])!);

        expect(stateAccount.getCheckerCountForPeriod(100)).toBe(null);
        expect(stateAccount.getCheckerCountForPeriod(101)).toBe(1);
        expect(stateAccount.getCheckerCountForPeriod(200)).toBe(1);

        // Mint another checker
        await lite.buildTransaction()
            .addInstruction(await mintChecker.getInstruction())
            .sendTransaction({ payer: signer });

        expect(getTreeConfig(tree).numMinted).toBe(2n);

        stateAccount = BMBStateAccount.deserializeFrom(lite.getAccountData(stateAccountPda[0])!);

        expect(stateAccount.getCheckerCountForPeriod(100)).toBe(null);
        expect(stateAccount.getCheckerCountForPeriod(101)).toBe(2);
        expect(stateAccount.getCheckerCountForPeriod(200)).toBe(2);

        // Go to next period and mint another checker
        lite.goToPeriod(101);
        await lite.buildTransaction()
            .addInstruction(await mintChecker.getInstruction())
            .sendTransaction({ payer: signer });

        expect(getTreeConfig(tree).numMinted).toBe(3n);

        stateAccount = BMBStateAccount.deserializeFrom(lite.getAccountData(stateAccountPda[0])!);

        expect(stateAccount.getCheckerCountForPeriod(100)).toBe(null);
        expect(stateAccount.getCheckerCountForPeriod(101)).toBe(2);
        expect(stateAccount.getCheckerCountForPeriod(102)).toBe(3);
        expect(stateAccount.getCheckerCountForPeriod(200)).toBe(3);
    });

    function getTreeConfig(tree: Address) {
        const [treeConfigPda] = findTreeConfigPda(lite.getUmi(), { merkleTree: publicKey(tree) });
        const treeConfigData = lite.getAccountData(address(treeConfigPda));
        return getTreeConfigAccountDataSerializer().deserialize(treeConfigData)[0];
    }
});
