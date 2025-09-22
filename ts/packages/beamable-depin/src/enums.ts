export enum DepinInstruction {
    SubmitWorkerProof = 1,
    InitNetwork = 2,
    ActivateWorker = 3,
    ActivateCheckerLicenses = 4,
    ActivateChecker = 6,
    Unlock = 7,
    PayoutCheckerRewards = 8,
    UpdateWorkerUri = 9
}

export enum DepinAccountType {
    WorkerMetadata = 1,
    WorkerLicenseMetadata = 2,
    GlobalRewards = 3,
    WorkerProof = 4,
    BMBState = 5,
    CheckerMetadata = 6,
    CheckerLicenseMetadata = 7,
    TreasuryState = 8,
    LockedTokens = 9,
    TreasuryConfig = 10
}
