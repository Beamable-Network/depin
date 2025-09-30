import { mplBubblegum } from '@metaplex-foundation/mpl-bubblegum';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSolanaClient, getPublicSolanaRpcUrl } from 'gill';
import { askForSecretKey } from 'utils';

export async function createClient(network: 'devnet' | 'mainnet') {
    const rpcUrl = getPublicSolanaRpcUrl(network);
    const rpcClient = createSolanaClient({ urlOrMoniker: network });
    const umi = createUmi(rpcUrl, { commitment: 'confirmed' })
        .use(mplBubblegum());

    const signer = await askForSecretKey("Tx signer"); // Or use a browser wallet    
    return { umi, rpcClient, signer, network, rpcUrl };
}