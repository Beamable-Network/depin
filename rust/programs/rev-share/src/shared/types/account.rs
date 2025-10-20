use borsh::{BorshDeserialize, BorshSerialize};

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Copy, PartialEq)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum RevShareAccountType {
    GlobalState = 1,
    RevShareOffer = 2,
    UserStakePosition = 3,
}
