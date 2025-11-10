import { ActivateChecker, ActivateCheckerLicenses, ActivateWorker, BMB_MINT, BMBStateAccount, DEPIN_PROGRAM, InitNetwork, SetBMBState, TreasuryAuthority } from "@beamable-network/depin";
import { AssetWithProof } from "@metaplex-foundation/mpl-bubblegum";
import { Address } from "gill";
import { LiteDepin, LiteKeyPair } from "./lite-depin.js";

// Parameter types
export interface InitializeNetworkParams {
    lite: LiteDepin;
    signer: LiteKeyPair;
}

export interface StandardNetworkSetupParams {
    lite: LiteDepin;
    signer: LiteKeyPair;
}

export interface CreateCheckerParams {
    lite: LiteDepin;
    signer: LiteKeyPair;
    count: number;
}

export interface ActivateCheckerLicensesParams {
    lite: LiteDepin;
    signer: LiteKeyPair;
    count: number;
}

export interface CreateAndActivateWorkerParams {
    lite: LiteDepin;
    signer: LiteKeyPair;
    owner: LiteKeyPair;
    delegate?: LiteKeyPair;
}

export interface CreateAndActivateCheckerParams {
    lite: LiteDepin;
    signer: LiteKeyPair;
    owner: LiteKeyPair;
    delegate?: LiteKeyPair;
}

export interface ActivateCheckerParams {
    lite: LiteDepin;
    signer: LiteKeyPair;
    lic: AssetWithProof;
    delegate?: Address;
}

export async function initializeNetwork(
    params: InitializeNetworkParams
): Promise<number> {
    const { lite, signer } = params;
    const initNetworkInput = new InitNetwork(signer.address);

    // The init network instruction needs multiple calls due to progressive resizing
    let result;
    let callCount = 0;
    const maxCalls = 100; // Safety limit

    do {
        result = await lite.buildTransaction()
            .addInstruction(await initNetworkInput.getInstruction())
            .sendTransaction({ payer: signer });

        callCount++;

        // Safety check to prevent infinite loop
        if (callCount >= maxCalls) {
            throw new Error(`Initialization exceeded maximum calls (${maxCalls})`);
        }
    } while (result.logs && !result.logs.some(log => log.includes("Initialization done")));

    return callCount;
}

export async function standardNetworkSetup(params: StandardNetworkSetupParams): Promise<void> {
    const { lite, signer } = params;
    await lite.airdrop(signer, 10);

    await lite.setProgramUpgradeAuthority(DEPIN_PROGRAM, signer.web3PublicKey);
    await initializeNetwork({ lite, signer });

    // Initialize BMB mint and depintreasury with some tokens
    await lite.createToken(BMB_MINT, signer);
    const [depinTreasury] = await TreasuryAuthority.findDepinTreasuryPDA();
    await lite.mintToken(BMB_MINT, depinTreasury, BigInt(10_000_000_000), signer);

    await lite.createLicenseTree({ creator: signer });
}

export async function createCheckers(params: CreateCheckerParams): Promise<Array<[LiteKeyPair, AssetWithProof]>> {
    let checkers = [];
    for (let i = 0; i < params.count; i++) {
        const checkerOwner = await params.lite.generateKeyPair();
        await params.lite.airdrop(checkerOwner, 5);
        const checkerLicense = await params.lite.mintLicense({ creator: params.signer, to: checkerOwner });
        checkers.push([checkerOwner, checkerLicense]);
    }
    return checkers;
}

export async function activateCheckerLicenses(params: ActivateCheckerLicensesParams): Promise<void> {
    params.lite.goToPeriod(0);

    const activate = new ActivateCheckerLicenses({
        checker_count: params.count,
        period: 1,
        signer: params.signer.address
    });

    params.lite.buildTransaction()
        .addInstruction(await activate.getInstruction())
        .sendTransaction({ payer: params.signer });

    const bmbStatePda = await BMBStateAccount.findPDA();
    const bmbStateData = params.lite.getAccountData(bmbStatePda[0]);
    const bmbState = BMBStateAccount.deserializeFrom(bmbStateData);

    const setBmbState = new SetBMBState({
        signer: params.signer.address,
        checkers_activated: bmbState.checkers_activated + params.count
    });

    params.lite.buildTransaction()
        .addInstruction(await setBmbState.getInstruction())
        .sendTransaction({ payer: params.signer });

    params.lite.goToPeriod(1);
}

export async function createAndActivateWorker(params: CreateAndActivateWorkerParams): Promise<AssetWithProof> {
    const { lite, signer, owner, delegate } = params;
    const lic = await lite.mintLicense({ creator: signer, to: signer });

    const activateWorkerInput = new ActivateWorker({
        worker_license: lic,
        delegated_to: (delegate ?? owner).address,
        discovery_uri: "https://example.com/worker/2",
        signer: signer.address
    });

    lite.buildTransaction()
        .addInstruction(await activateWorkerInput.getInstruction())
        .sendTransaction({ payer: signer });

    return lic;
}

export async function createAndActivateChecker(params: CreateAndActivateCheckerParams): Promise<AssetWithProof> {
    const { lite, signer, owner, delegate } = params;
    const lic = await lite.mintLicense({ creator: signer, to: signer });

    const activateCheckerInput = new ActivateChecker({
        checker_license: lic,
        delegated_to: (delegate ?? owner).address,
        signer: signer.address
    });

    lite.buildTransaction()
        .addInstruction(await activateCheckerInput.getInstruction())
        .sendTransaction({ payer: signer });

    return lic;
}

export async function activateChecker(params: ActivateCheckerParams): Promise<void> {
    const { lite, signer, lic, delegate } = params;

    const activateCheckerInput = new ActivateChecker({
        checker_license: lic,
        delegated_to: delegate,
        signer: signer.address
    });

    lite.buildTransaction()
        .addInstruction(await activateCheckerInput.getInstruction())
        .sendTransaction({ payer: signer });
}