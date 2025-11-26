export enum DepinInstruction {
    SubmitWorkerProof = 1,
    InitNetwork = 2,
    ActivateWorker = 3,
    ActivateCheckerLicenses = 4,
    ActivateChecker = 6,
    Unlock = 7,
    PayoutCheckerRewards = 8,
    UpdateWorkerUri = 9,
    SetBMBState = 10,
    SetCheckerRewardsVault = 11,
    ViewCheckerReward = 12,
    FlexLock = 13,
    FlexUnlock = 14,
}

export enum DepinAccountType {
    WorkerMetadata = 1,
    WorkerLicenseMetadata = 2,
    GlobalRewards = 3,
    WorkerProof = 4,
    BMBState = 5,
    CheckerMetadata = 6,
    CheckerLicenseMetadata = 7,
    LockedTokens = 9,
    FlexlockTokens = 11,
    CheckerRewardsVault = 12
}

export enum WorkerStakeInstruction {
    InitializeWorkerStakeConfig = 0x01,
    UpdateWorkerWallet = 0x02,
    UpdateMinStakeRequirement = 0x03,
    SetMonthlyPool = 0x04,
    WorkerStake = 0x05,
    WorkerUnstake = 0x06,
    Stake = 0x07,
    Unstake = 0x08,
    Withdraw = 0x09,
    ClaimRewards = 0x0a,
    DepositRevenue = 0x0b,
    DepositEmissions = 0x0c
}

export enum WorkerStakeAccountType {
    WorkerStakeConfig = 0x01,
    MonthlyPool = 0x02,
    UserStakePosition = 0x03
}
