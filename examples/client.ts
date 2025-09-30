import { mplBubblegum } from '@metaplex-foundation/mpl-bubblegum';
import { signerIdentity } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSolanaClient, getPublicSolanaRpcUrl } from 'gill';
import { askForSecretKey } from 'utils';

export async function createClient(network: 'devnet' | 'mainnet') {
    const rpcUrl = getPublicSolanaRpcUrl(network);
    const rpcClient = createSolanaClient({ urlOrMoniker: network });
    const umi = createUmi(rpcUrl, { commitment: 'confirmed' })
        .use(mplBubblegum());

    const umiSigner = await askForSecretKey("Tx umiSigner", umi); // Or use a browser wallet
    umi.use(signerIdentity(umiSigner));

    return { umi, rpcClient, umiSigner, network, rpcUrl };
}