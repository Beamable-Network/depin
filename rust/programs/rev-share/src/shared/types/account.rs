use borsh::{BorshDeserialize, BorshSerialize};

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Copy, PartialEq)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum RevShareAccountType {
    OfferBook = 1,
    UserStakePosition = 3,
}
