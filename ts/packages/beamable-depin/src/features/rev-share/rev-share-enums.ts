export enum RevShareInstruction {
    InitializeOffer = 1,
    Stake = 2,
    AddStake = 3,
    OptOutRollover = 4,
    Unstake = 5,
    ClaimRewards = 6,
    DepositRevenue = 7,
}

export enum RevShareAccountType {
    GlobalState = 1,
    RevShareOffer = 2,
    UserStakePosition = 3,
}
