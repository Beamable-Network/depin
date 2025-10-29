// Depin-specific types
pub mod types {
    pub mod ring_buffer;
}

// Depin-specific utils
pub mod utils {
    pub mod brand;
}

// Depin-specific constants
pub mod constants {
    pub mod seeds;
    pub mod programs;
}

pub mod features {
    pub mod rewards {
        pub mod accounts;
    }
    pub mod worker {
        pub mod accounts;
    }
    pub mod global {
        pub mod accounts;
    }
    pub mod checker {
        pub mod accounts;
    }
    pub mod treasury {
        pub mod accounts;
        pub mod utils;
    }
}