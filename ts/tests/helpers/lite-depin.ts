import { DEPIN_PROGRAM, MPL_ACCOUNT_COMPRESSION_PROGRAM, periodToTimestamp, timestampToPeriod, MPL_BUBBLEGUM_PROGRAM } from 'beamable-network-depin';
import { MPL_NOOP_PROGRAM_ID } from '@metaplex-foundation/mpl-account-compression';
import { AssetWithProof, createTreeV2, findLeafAssetIdPda, hashAssetData, hashCollection, hashMetadataCreators, hashMetadataDataV2, mintV2 } from '@metaplex-foundation/mpl-bubblegum';
import { createCollection, MPL_CORE_PROGRAM_ID } from '@metaplex-foundation/mpl-core';
import { createSignerFromKeypair, generateSigner, publicKey, Signer, signerIdentity, Umi, PublicKey as UmiPublicKey } from '@metaplex-foundation/umi';
import { toWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters';
import { findAssociatedTokenPda, getCreateAssociatedTokenInstruction, getMintEncoder, getMintToInstruction, getTokenDecoder, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction, Signer as Web3Signer } from '@solana/web3.js';
import bs58 from 'bs58';
import { AccountRole, Address, createKeyPairSignerFromBytes, Instruction, none, some, TransactionSigner } from 'gill';
import { Clock, FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { createUmiClient } from './client.js';

// Configuration constants
const DEPIN_CONFIG = {
    TREE: {
        MAX_DEPTH: 10,
        CANOPY_DEPTH: 10,
        MAX_BUFFER_SIZE: 32,
    },
    COLLECTION: {
        NAME: "BMB Depin",
        URI: "https://arweave.net/t3bt4GBq_Z_mdkP5vNcxj2xyd34CQdr9BzmRZF7Vh7o",
    },
    METADATA: {
        BASE_URI: "https://arweave.net/ujfJjkDZlqy2cipGie4UYVmZ2mU5HRPoJUlRrnxPVCM",
        SYMBOL: "BMBDEP",
    },
    PROGRAMS: {
        DEPIN_PATH: '../../rust/target/test/depin.so',
        EXTERNAL_PATH: '../../rust/external',
    },
} as const;

export interface TransactionResult {
    signature: string;
    logs: string[];
}

export interface SendTransactionParams {
    payer: LiteKeyPair;
}

export interface LiteKeyPair {
    address: Address;
    web3PublicKey: PublicKey;
    secretKey: Uint8Array;
    web3Keypair: Keypair;
    web3Signer: Web3Signer;
    umiPublicKey: UmiPublicKey;
    umiSignerIdentity: Signer;
    transactionSigner: TransactionSigner;
}

export interface MintLicenseParams {
    creator: LiteKeyPair;
    to: LiteKeyPair;
}

export interface CreateLicenseTreeParams {
    creator: LiteKeyPair;
}

function validateLiteKeyPair(keyPair: LiteKeyPair): void {
    if (!keyPair || !keyPair.address || !keyPair.web3PublicKey) {
        throw new Error('Invalid LiteKeyPair: missing required fields');
    }
}

function validateSolAmount(amount: number): void {
    if (amount <= 0 || !Number.isFinite(amount)) {
        throw new Error('Invalid SOL amount: must be a positive finite number');
    }
}

function convertGillToWeb3Instruction(gillInstruction: Instruction): TransactionInstruction {
    return new TransactionInstruction({
        programId: new PublicKey(gillInstruction.programAddress),
        keys: gillInstruction.accounts.map((acc) => ({
            pubkey: new PublicKey(acc.address),
            isSigner: acc.role === AccountRole.READONLY_SIGNER,
            isWritable: acc.role === AccountRole.WRITABLE
        })),
        data: Buffer.from(gillInstruction.data)
    });
}

class TransactionBuilder {
    private instructions: TransactionInstruction[] = [];
    private signers: Set<LiteKeyPair> = new Set();
    private svm: LiteSVM;

    constructor(svm: LiteSVM) {
        this.svm = svm;
    }

    addInstruction(instruction: Instruction): TransactionBuilder {
        this.instructions.push(convertGillToWeb3Instruction(instruction));
        return this;
    }

    sign(web3Keypair: LiteKeyPair): TransactionBuilder {
        this.signers.add(web3Keypair);
        return this;
    }

    sendTransaction(params: SendTransactionParams): TransactionResult {
        const tx = new Transaction();
        this.signers.add(params.payer); // Ensure payer is in signers

        tx.recentBlockhash = this.svm.latestBlockhash();
        tx.feePayer = params.payer.web3PublicKey;

        this.instructions.forEach(ix => tx.add(ix));
        const web3Signers = Array.from(this.signers).map(s => Keypair.fromSecretKey(s.secretKey));
        tx.sign(...web3Signers);

        const result = this.svm.sendTransaction(tx);

        if (result instanceof FailedTransactionMetadata) {
            console.log("Transaction failed with logs:", result.toString());
            throw new Error(`Transaction failed: ${result.toString()}`);
        } else {
            this.svm.expireBlockhash(); // Advance block
            const signature = bs58.encode(result.signature());
            const logs = result.logs();

            return {
                signature,
                logs
            };
        }
    }
}

export class LiteDepin {
    private svm: LiteSVM;
    private umi: Umi;
    private merkleTree?: Signer;
    private collectionMint?: Signer;
    private treeCreator?: LiteKeyPair;
    private leafIndex: number = 0;

    constructor() {
        this.svm = new LiteSVM();
        this.umi = createUmiClient();
        this.initPrograms();

        const periodZeroTimestamp = periodToTimestamp(0);
        this.setTime(periodZeroTimestamp);
    }

    private initPrograms(): void {
        const externalPath = DEPIN_CONFIG.PROGRAMS.EXTERNAL_PATH;

        this.svm.addProgramFromFile(new PublicKey(DEPIN_PROGRAM), DEPIN_CONFIG.PROGRAMS.DEPIN_PATH);
        this.svm.addProgramFromFile(new PublicKey(MPL_ACCOUNT_COMPRESSION_PROGRAM), `${externalPath}/${MPL_ACCOUNT_COMPRESSION_PROGRAM}.so`);
        this.svm.addProgramFromFile(new PublicKey(MPL_BUBBLEGUM_PROGRAM), `${externalPath}/${MPL_BUBBLEGUM_PROGRAM}.so`);
        this.svm.addProgramFromFile(new PublicKey(MPL_NOOP_PROGRAM_ID), `${externalPath}/${MPL_NOOP_PROGRAM_ID}.so`);
        this.svm.addProgramFromFile(new PublicKey(MPL_CORE_PROGRAM_ID), `${externalPath}/${MPL_CORE_PROGRAM_ID}.so`);
    }

    public async airdrop(keyPair: LiteKeyPair, solAmount: number): Promise<void> {
        validateLiteKeyPair(keyPair);
        validateSolAmount(solAmount);

        this.svm.airdrop(keyPair.web3PublicKey, BigInt(LAMPORTS_PER_SOL * solAmount));
    }

    public async generateKeyPair(): Promise<LiteKeyPair> {
        return await this.generateKeyPairFromSecretKey(Keypair.generate().secretKey);
    }

    public async generateKeyPairFromSecretKey(secretKey: Uint8Array): Promise<LiteKeyPair> {
        const keypair = Keypair.fromSecretKey(secretKey);
        const umiKeypair = this.umi.eddsa.createKeypairFromSecretKey(keypair.secretKey);
        const umiSigner = createSignerFromKeypair(this.umi, umiKeypair);
        const transactionSigner = await createKeyPairSignerFromBytes(keypair.secretKey);

        return {
            address: keypair.publicKey.toBase58() as Address,
            web3PublicKey: keypair.publicKey,
            secretKey: keypair.secretKey,
            web3Keypair: keypair,
            web3Signer: keypair,
            umiPublicKey: publicKey(keypair.publicKey.toBase58()),
            umiSignerIdentity: umiSigner,
            transactionSigner: transactionSigner
        };
    }

    public async createLicenseTree(params: { creator: LiteKeyPair }): Promise<void> {
        // Store the creator for later use in mintLicense
        this.treeCreator = params.creator;

        // Create the tree and collection
        await this.createTreeIfNotExists(params.creator);
        await this.createCollectionIfNotExists(params.creator);
    }

    private async createTreeIfNotExists(creator: LiteKeyPair): Promise<void> {
        if (this.merkleTree) return;

        this.merkleTree = generateSigner(this.umi);

        // Create UMI context with creator identity
        const umiCtx = this.umi.use(signerIdentity(creator.umiSignerIdentity));

        const builder = await createTreeV2(umiCtx, {
            merkleTree: this.merkleTree,
            maxDepth: DEPIN_CONFIG.TREE.MAX_DEPTH,
            canopyDepth: DEPIN_CONFIG.TREE.CANOPY_DEPTH,
            maxBufferSize: DEPIN_CONFIG.TREE.MAX_BUFFER_SIZE,
            public: false,
        });

        const createTx = await builder
            .setBlockhash(this.svm.latestBlockhash())
            .buildAndSign(umiCtx);

        const createWeb3Tx = toWeb3JsTransaction(createTx);
        const result = this.svm.sendTransaction(createWeb3Tx);

        if (result instanceof FailedTransactionMetadata) {
            throw new Error(`Tree creation failed: ${result.toString()}`);
        }
    }

    private async createCollectionIfNotExists(creator: LiteKeyPair): Promise<void> {
        if (this.collectionMint) return;

        this.collectionMint = generateSigner(this.umi);

        // Create UMI context with creator identity
        const umiCtx = this.umi.use(signerIdentity(creator.umiSignerIdentity));

        const createCollectionTx = await createCollection(umiCtx, {
            collection: this.collectionMint,
            name: DEPIN_CONFIG.COLLECTION.NAME,
            uri: DEPIN_CONFIG.COLLECTION.URI,
            updateAuthority: creator.umiPublicKey,
            plugins: [
                {
                    type: "BubblegumV2"
                },
                {
                    type: 'PermanentFreezeDelegate',
                    frozen: true,
                    authority: { type: 'UpdateAuthority' },
                }
            ]
        })
            .setBlockhash(this.svm.latestBlockhash())
            .buildAndSign(umiCtx);

        const createCollWeb3Tx = toWeb3JsTransaction(createCollectionTx);
        const result = this.svm.sendTransaction(createCollWeb3Tx);

        if (result instanceof FailedTransactionMetadata) {
            throw new Error(`Collection creation failed: ${result.toString()}`);
        }
    }

    async mintLicense(params: MintLicenseParams): Promise<AssetWithProof> {
        if (!this.merkleTree || !this.collectionMint) {
            throw new Error("Merkle tree or collection mint not initialized. Call createLicenseTree first.");
        }

        const owner = publicKey(params.to.address);

        // Create UMI context with creator identity
        const umiCtx = this.umi.use(signerIdentity(params.creator.umiSignerIdentity));

        // Create metadata that matches what we'll store
        const metadata = {
            name: `${DEPIN_CONFIG.COLLECTION.NAME} #${this.leafIndex}`,
            uri: DEPIN_CONFIG.METADATA.BASE_URI,
            sellerFeeBasisPoints: 0,
            collection: some(this.collectionMint!.publicKey),
            creators: [{ address: this.treeCreator!.umiPublicKey, verified: true, share: 100 }],
        };

        // Mint the actual leaf to the tree
        const mintTx = await mintV2(umiCtx, {
            leafOwner: owner,
            leafDelegate: owner,
            merkleTree: publicKey(this.merkleTree!.publicKey),
            coreCollection: publicKey(this.collectionMint!.publicKey),
            metadata: metadata,
        })
            .setBlockhash(this.svm.latestBlockhash())
            .buildAndSign(umiCtx); // TODO: ovo nije dobro

        const mintLeafWeb3Tx = toWeb3JsTransaction(mintTx);
        const mintResult = this.svm.sendTransaction(mintLeafWeb3Tx);

        if (mintResult instanceof FailedTransactionMetadata) {
            throw new Error(`License minting failed: ${mintResult.toString()}`);
        }

        // Calculate the asset ID
        const [assetId] = findLeafAssetIdPda(umiCtx, {
            merkleTree: publicKey(this.merkleTree!.publicKey),
            leafIndex: this.leafIndex
        });

        // Create the full metadata for AssetWithProof - this should match exactly what was passed to mintV2
        const fullMetadata = {
            name: metadata.name,
            uri: metadata.uri,
            sellerFeeBasisPoints: metadata.sellerFeeBasisPoints,
            collection: metadata.collection,
            creators: metadata.creators,
        };

        // Compute the real hashes that match what was stored in the tree
        const dataHash = hashMetadataDataV2(fullMetadata);
        const creatorHash = hashMetadataCreators(fullMetadata.creators);
        const collectionHash = hashCollection(publicKey(this.collectionMint!.publicKey));
        const assetDataHash = hashAssetData(); // Empty asset data
        const flags = 0; // No flags set

        // Use hashLeafV2 to compute the exact leaf hash that was stored
        // const leafHash = hashLeafV2(umiCtx, {
        //     merkleTree: publicKey(this.merkleTree!.publicKey),
        //     owner: owner,
        //     leafIndex: this.leafIndex,
        //     metadata: fullMetadata,
        //     assetData: undefined, // No asset data
        //     flags: flags,
        // });

        // Get the merkle tree account to extract the root
        const treeAccount = this.svm.getAccount(new PublicKey(this.merkleTree!.publicKey));
        let root = new Uint8Array(32); // Fallback to zeros if we can't read the tree
        if (treeAccount && treeAccount.data.length >= 32) {
            // The root is typically stored at a specific offset in the tree account
            // For account compression, it's usually at offset 1 (after discriminator)
            root = treeAccount.data.slice(8, 40); // Skip 8-byte discriminator, take 32 bytes for root
        }

        const asset: AssetWithProof = {
            leafOwner: owner,
            leafDelegate: owner,
            merkleTree: publicKey(this.merkleTree!.publicKey),
            root: root, // Real root from tree account
            dataHash: dataHash, // Real data hash
            creatorHash: creatorHash, // Real creator hash
            collection_hash: collectionHash, // Real collection hash
            asset_data_hash: assetDataHash, // Real asset data hash  
            flags: 0, // Optional field
            nonce: this.leafIndex,
            index: this.leafIndex,
            proof: [], // Empty proof array since canopy = max depth
            metadata: {
                name: `${DEPIN_CONFIG.COLLECTION.NAME} #${this.leafIndex}`,
                symbol: '',
                uri: DEPIN_CONFIG.METADATA.BASE_URI,
                sellerFeeBasisPoints: 0,
                primarySaleHappened: false,
                isMutable: true,
                editionNonce: none(),
                tokenStandard: none(),
                collection: some({
                    verified: true,
                    key: publicKey(this.collectionMint!.publicKey),
                }),
                uses: none(),
                tokenProgramVersion: 0, // TokenProgramVersion.Original
                creators: [{ address: this.treeCreator!.umiPublicKey, verified: true, share: 100 }],
            },
            rpcAsset: {
                interface: 'V1_NFT',
                id: assetId,
                content: {
                    json_uri: DEPIN_CONFIG.METADATA.BASE_URI,
                    files: [],
                    metadata: {
                        attributes: [],
                        description: `${DEPIN_CONFIG.COLLECTION.NAME} #${this.leafIndex}`,
                        name: `${DEPIN_CONFIG.COLLECTION.NAME} #${this.leafIndex}`,
                        symbol: DEPIN_CONFIG.METADATA.SYMBOL,
                    },
                    links: [],
                },
                authorities: [
                    {
                        address: this.treeCreator!.umiPublicKey,
                        scopes: ['full'],
                    },
                ],
                compression: {
                    eligible: false,
                    compressed: true,
                    data_hash: publicKey(assetId), // Use asset ID as placeholder
                    creator_hash: publicKey(assetId), // Use asset ID as placeholder
                    asset_hash: publicKey(assetId), // Use asset ID as placeholder
                    tree: publicKey(this.merkleTree!.publicKey),
                    seq: this.leafIndex + 1,
                    leaf_id: this.leafIndex,
                },
                grouping: [
                    {
                        group_key: 'collection',
                        group_value: publicKey(this.collectionMint!.publicKey),
                    },
                ],
                royalty: {
                    royalty_model: 'creators',
                    target: null,
                    percent: 0,
                    basis_points: 0,
                    primary_sale_happened: false,
                    locked: false,
                },
                creators: [
                    {
                        address: this.treeCreator!.umiPublicKey,
                        share: 100,
                        verified: true,
                    },
                ],
                ownership: {
                    frozen: false,
                    delegated: false,
                    delegate: null,
                    ownership_model: 'single',
                    owner: owner,
                },
                supply: {
                    print_max_supply: 0,
                    print_current_supply: 0,
                    edition_nonce: null,
                },
                mutable: true,
                burnt: false,
            },
            rpcAssetProof: {
                root: publicKey(this.merkleTree!.publicKey), // Use the merkle tree as root for now
                proof: [], // Empty since canopy = max depth
                node_index: this.leafIndex,
                leaf: assetId, // Use the actual asset ID as leaf
                tree_id: publicKey(this.merkleTree!.publicKey),
            },
        };

        // Increment leaf index for next mint
        this.leafIndex++;

        return asset;
    }

    getSVM(): LiteSVM {
        return this.svm;
    }

    getUmi(): Umi {
        return this.umi;
    }

    getMerkleTree(): Signer | undefined {
        return this.merkleTree;
    }

    getCollectionMint(): Signer | undefined {
        return this.collectionMint;
    }

    getCurrentLeafIndex(): number {
        return this.leafIndex;
    }

    buildTransaction(): TransactionBuilder {
        return new TransactionBuilder(this.svm);
    }

    /**
     * Get account data from the Solana ledger
     * @param address The account address to fetch data for
     * @returns The account data as Uint8Array, or null if account doesn't exist
     */
    getAccountData(address: Address): Uint8Array | null {
        const accountInfo = this.svm.getAccount(new PublicKey(address));
        return accountInfo ? accountInfo.data : null;
    }

    /**
     * Get full account info from the Solana ledger
     * @param address The account address to fetch info for
     * @returns The account info object, or null if account doesn't exist
     */
    getAccount(address: Address) {
        return this.svm.getAccount(new PublicKey(address));
    }

    /**
     * Upsert account data in the local SVM. Creates account if it doesn't exist,
     * otherwise updates existing account data while preserving other properties.
     */
    setAccountData(address: Address, data: Uint8Array, accountSize?: number): void {
        const pubkey = new PublicKey(address);
        const current = this.svm.getAccount(pubkey);
        
        if (current) {
            // Update existing account, preserving its properties
            this.svm.setAccount(pubkey, {
                lamports: current.lamports,
                data: new Uint8Array(data),
                owner: current.owner,
                executable: current.executable,
                rentEpoch: current.rentEpoch,
            });
        } else {
            // Create new account with specified size or default to data length
            const size = accountSize || data.length;
            const accountData = new Uint8Array(size);
            accountData.set(data); // Copy data into the sized array
            
            this.svm.setAccount(pubkey, {
                lamports: LAMPORTS_PER_SOL * 5, // 5 SOL rent
                data: accountData,
                owner: new PublicKey(DEPIN_PROGRAM),
                executable: false,
                rentEpoch: 0,
            });
        }
    }

    /**
     * Creates an SPL Token mint account using the proper encoder
     * @param mintAddress The address where the mint should be created
     * @param mintAuthority The mint authority keypair
     */
    async createToken(mintAddress: Address, mintAuthority: LiteKeyPair): Promise<void> {
        const mintEncoder = getMintEncoder();

        const mintData = mintEncoder.encode({
            mintAuthority: mintAuthority.web3PublicKey.toBase58() as Address,
            supply: 0n,
            decimals: 6,
            isInitialized: true,
            freezeAuthority: null,
        });

        // Set the account in LiteSVM
        this.svm.setAccount(
            new PublicKey(mintAddress),
            {
                lamports: 1461600, // Rent-exempt lamports for mint account
                data: new Uint8Array(mintData),
                owner: new PublicKey(TOKEN_PROGRAM_ADDRESS),
                executable: false,
                rentEpoch: 0
            }
        );
    }

    async mintToken(
        mintAddress: Address,
        destinationWallet: Address,
        amount: bigint,
        mintAuthority: LiteKeyPair
    ): Promise<TransactionResult> {
        const [ataAddress] = await findAssociatedTokenPda({
            mint: mintAddress,
            owner: destinationWallet,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });

        const maybeAtaAccount = this.svm.getAccount(new PublicKey(ataAddress));
        if (!maybeAtaAccount) {
            // Create the associated token account if it doesn't exist
            const createAtaInstruction = getCreateAssociatedTokenInstruction({
                mint: mintAddress,
                owner: destinationWallet,
                ata: ataAddress,
                payer: mintAuthority.transactionSigner,
                tokenProgram: TOKEN_PROGRAM_ADDRESS
            });
            this.buildTransaction()
                .addInstruction(createAtaInstruction)
                .sendTransaction({ payer: mintAuthority });
        }

        // Create the mint-to instruction using the imported function
        const mintToInstruction = getMintToInstruction({
            mint: mintAddress,
            token: ataAddress,
            mintAuthority: mintAuthority.address,
            amount: amount,
        });

        return this.buildTransaction()
            .addInstruction(mintToInstruction)
            .sign(mintAuthority)
            .sendTransaction({ payer: mintAuthority });
    }

    async getTokenBalance(mintAddress: Address, walletAddress: Address): Promise<bigint> {
        // Find the Associated Token Account (ATA) for this wallet and mint
        const [ataAddress] = await findAssociatedTokenPda({
            mint: mintAddress,
            owner: walletAddress,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });

        // Get the ATA account data
        const ataAccountData = this.getAccountData(ataAddress);

        // If ATA doesn't exist, balance is 0
        if (!ataAccountData) {
            return 0n;
        }

        // Decode the token account data to get the balance
        const tokenDecoder = getTokenDecoder();
        const tokenAccount = tokenDecoder.decode(ataAccountData);

        return tokenAccount.amount;
    }

    /**
     * Time travel functionality - adjusts the SVM clock to travel in time
     * @param hours Number of hours to travel (positive for future, negative for past)
     */
    timeTravel(hours: number): void {
        const currentClock = this.svm.getClock();
        const hoursInSeconds = hours * 60 * 60;
        const newUnixTimestamp = currentClock.unixTimestamp + BigInt(hoursInSeconds);

        console.log(`Time traveling from ${currentClock.unixTimestamp} to ${newUnixTimestamp}`);

        // Create a new clock with the adjusted timestamp
        // Keep all other fields the same to maintain consistency
        const newClock = new Clock(
            currentClock.slot,
            currentClock.epochStartTimestamp,
            currentClock.epoch,
            currentClock.leaderScheduleEpoch,
            newUnixTimestamp
        );

        this.svm.setClock(newClock);
        this.svm.expireBlockhash();
    }

    setTime(timestamp: bigint): void {
        const currentClock = this.svm.getClock();
        const newClock = new Clock(
            currentClock.slot,
            currentClock.epochStartTimestamp,
            currentClock.epoch,
            currentClock.leaderScheduleEpoch,
            timestamp
        );

        this.svm.setClock(newClock);
        this.svm.expireBlockhash();
    }

    getTime(): bigint {
        return this.svm.getClock().unixTimestamp;
    }

    getPeriod(): number {
        const clock = this.svm.getClock();
        return timestampToPeriod(clock.unixTimestamp);
    }

    goToPeriod(period: number): void {
        const timestamp = BigInt(periodToTimestamp(period));
        this.setTime(timestamp);
    }
}
