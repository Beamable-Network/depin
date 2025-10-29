#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum WorkerStakeAccountType {
    WorkerStakeConfig = 1,
    MonthlyPool = 2,
    UserStakePosition = 3,
}

impl Into<u8> for WorkerStakeAccountType {
    fn into(self) -> u8 {
        self as u8
    }
}
