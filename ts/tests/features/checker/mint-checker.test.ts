import { describe, expect, it } from 'vitest';

import { BMB_DECIMALS, BMB_MINT, bmbToBaseUnits, CheckerLicenseAuthority, DEPIN_PROGRAM, MintChecker } from '@beamable-network/depin';
import { findTreeConfigPda, getLeafSchemaSerializer, getTreeConfigAccountDataSerializer } from '@metaplex-foundation/mpl-bubblegum';
import { publicKey } from '@metaplex-foundation/umi';
import { Address, address } from 'gill';
import { LiteDepin } from '../../helpers/lite-depin.js';

describe('Checker minting', async () => {
    const lite = new LiteDepin();

    const signer = await lite.generateKeyPair();
    const treeCreator = await lite.generateKeyPair();
    const [checkerLicenseAuthorityPda] = await CheckerLicenseAuthority.findPDA();

    await lite.airdrop(signer, 10);
    await lite.airdrop(treeCreator, 10);
    
    await lite.createToken(BMB_MINT, signer);
    await lite.setProgramUpgradeAuthority(DEPIN_PROGRAM, signer.web3PublicKey);
    await lite.createLicenseTree({ creator: treeCreator, delegatedAuthority: checkerLicenseAuthorityPda });

    const tree = address(lite.getMerkleTree().publicKey);

    await lite.createToken(BMB_MINT, signer, BMB_DECIMALS);
    await lite.mintToken(BMB_MINT, signer.address, bmbToBaseUnits(1_000_000), signer); // Mint 1M BMB to signer

    it('should be able to mint a checker', async () => {
        expect(getTreeConfig(tree).numMinted).toBe(0n);

        const mintChecker = new MintChecker({
            minter: signer.address,
            mintReceiver: address("UZAkx8aZ3tnJ6zm446m1MnBGR7dycshvoftaSCRXWVF"),
            merkleTree: tree,
        });

        let txResponse = await lite.buildTransaction()
            .addInstruction(await mintChecker.getInstruction())
            .sendTransaction({ payer: signer });

        let [ parsedLeaf ] = getLeafSchemaSerializer().deserialize(txResponse.returnData, 0);
        expect(parsedLeaf.owner).toEqual(publicKey(mintChecker.mintReceiver));

        expect(getTreeConfig(tree).numMinted).toBe(1n);

        // Another mint
        txResponse = await lite.buildTransaction()
            .addInstruction(await mintChecker.getInstruction())
            .sendTransaction({ payer: signer });

        [ parsedLeaf ] = getLeafSchemaSerializer().deserialize(txResponse.returnData, 0);
        expect(parsedLeaf.owner).toEqual(publicKey(mintChecker.mintReceiver));

        expect(getTreeConfig(tree).numMinted).toBe(2n);
    });

    function getTreeConfig(tree: Address) {
        const [treeConfigPda] = findTreeConfigPda(lite.getUmi(), { merkleTree: publicKey(tree) });
        const treeConfigData = lite.getAccountData(address(treeConfigPda));
        return getTreeConfigAccountDataSerializer().deserialize(treeConfigData)[0];
    }
});
