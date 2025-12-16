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
    FlexlockTokens = 11,
    CheckerRewardsVault = 12,
    CheckerLicenseAuthority = 13,
}

impl Into<u8> for DepinAccountType {
    fn into(self) -> u8 {
        self as u8
    }
}
