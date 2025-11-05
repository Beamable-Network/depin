import {
    BMB_MINT,
    bmbToBaseUnits,
    InitializeWorkerStakeConfig,
    MonthlyPoolConfig,
    SetMonthlyPool,
    Stake,
    WORKER_STAKE_PROGRAM
} from '@beamable-network/depin';
import { AssetWithProof } from '@metaplex-foundation/mpl-bubblegum';
import { addSignersToTransactionMessage, blockhash, getCompiledTransactionMessageCodec, isFullySignedTransaction, signTransaction, signTransactionMessageWithSigners } from '@solana/kit';
import { Address, address, createTransaction, getTransactionDecoder, getTransactionEncoder, createTransactionMessage, partiallySignTransactionMessageWithSigners, isTransactionPartialSigner } from 'gill';
import { beforeEach, describe, expect, it } from 'vitest';
import { LiteDepin, LiteKeyPair } from '../../helpers/lite-depin.js';
import { setupTokens, TokenAuthorities } from '../../helpers/spl-tokens.js';

describe('User Stake Instructions', async () => {
    let lite: LiteDepin;
    let stakeAdmin: LiteKeyPair;
    let workerCollection: Address;
    let tokenAuthorities: TokenAuthorities;
    let collectionCreator: LiteKeyPair;
    let workerWallet: LiteKeyPair;
    let worker: LiteKeyPair;
    let workerLicense: AssetWithProof;

    beforeEach(async () => {
        lite = new LiteDepin();

        // Set clock to period 5
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

        // Create a monthly pool for current month (month_period: 5)
        const pools: MonthlyPoolConfig[] = [{
            month_period: 5,
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
    });

    describe('Stake Encoding', () => {
        it('should properly encode/decode stake transaction and add worker signature after decoding', async () => {
            const user = await lite.generateKeyPair();

            await lite.airdrop(user, 2);

            const stakeAmount = bmbToBaseUnits(7500); // 7500 BMB
            const checkerCount = 3; // 3 checker licenses

            // Mint BMB to user
            await lite.mintToken(BMB_MINT, user.address, stakeAmount, tokenAuthorities.bmbMintAuthority);

            const stake = new Stake({
                user: user.address,
                worker: worker.address,
                worker_license: workerLicense,
                worker_collection: workerCollection,
                amount: stakeAmount,
                checker_count: checkerCount,
                current_month_period: 5,
            });

            const ix = await stake.getInstruction();

            let tx = createTransaction({
                version: 0,
                latestBlockhash: { blockhash: blockhash(lite.getLatestBlockhash()), lastValidBlockHeight: 0n },
                instructions: [ix],
                feePayer: worker.address
            });
            tx = addSignersToTransactionMessage([user.transactionSigner], tx);
            
            const partiallySignedTx = await partiallySignTransactionMessageWithSigners(tx);

            if (!isTransactionPartialSigner(user.transactionSigner)) {
                throw new Error('User signer must be a TransactionPartialSigner');
            }

            expect(isFullySignedTransaction(partiallySignedTx)).toBe(false);

            // Encode to base64 (ready to send to worker endpoint)
            const encoder = getTransactionEncoder();
            const txBytes = encoder.encode(partiallySignedTx);            

            // Verify we can decode it back
            const decoder = getTransactionDecoder();
            let decoded = decoder.decode(txBytes);

            expect(decoded.signatures[user.address]).toBeDefined();
            expect(decoded.messageBytes).toBeDefined();
            expect(isFullySignedTransaction(decoded)).toBe(false);

            // Add worker signature
            if (!isTransactionPartialSigner(worker.transactionSigner)) {
                throw new Error('Worker signer must be a TransactionPartialSigner');
            }
            const [workerSignature] = await worker.transactionSigner.signTransactions([decoded]);
            const fullySigned = {
                ...decoded,
                signatures: { ...decoded.signatures, ...workerSignature }
            };

            // Decode the transaction message to inspect accounts and instructions
            const messageCodec = getCompiledTransactionMessageCodec();
            const decodedMessage = messageCodec.decode(decoded.messageBytes);

            console.log('Transaction version:', decodedMessage.version);
            console.log('Number of instructions:', decodedMessage.instructions.length);
            
            // Check the first (and only) instruction in this transaction
            const instruction = decodedMessage.instructions[0];
            const programAddress = decodedMessage.staticAccounts[instruction.programAddressIndex];
            
            console.log('Program address:', programAddress);
            console.log('Instruction accounts count:', instruction.accountIndices?.length ?? 0);
            console.log('Instruction data length:', instruction.data?.length ?? 0);
            
            // Verify it's the worker stake program
            expect(programAddress).toBe(WORKER_STAKE_PROGRAM);
            
            // Verify accounts are present
            expect(instruction.accountIndices).toBeDefined();
            expect(instruction.accountIndices!.length).toBeGreaterThan(0);
            
            // Verify instruction data
            expect(instruction.data).toBeDefined();
            expect(instruction.data!.length).toBeGreaterThan(0);

            expect(isFullySignedTransaction(fullySigned)).toBe(true);
        });
    });
});
