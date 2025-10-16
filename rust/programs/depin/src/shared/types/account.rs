#[repr(u8)]
#[derive(Copy, Clone)]
pub enum DepinAccountType {
    WorkerMetadata = 1,
    WorkerLicenseMetadata = 2,
    GlobalRewards = 3,
    WorkerProof = 4,
    BMBState = 5,
    CheckerMetadata = 6,
    CheckerLicenseMetadata = 7,
    TreasuryState = 8,
    LockedTokens = 9,
    TreasuryConfig = 10,
}
