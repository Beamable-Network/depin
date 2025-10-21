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
    OfferBook = 1,
    UserStakePosition = 3,
}
