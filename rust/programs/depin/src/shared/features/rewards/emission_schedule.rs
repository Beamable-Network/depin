#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MonthlyEmission {
    pub checkers: u64,
    pub workers: u64,
}

pub fn get_monthly_emission(month: u16) -> MonthlyEmission {
    match month {
        // Months 0-4 (Jun-Oct 2025): No emissions
        0..=4 => MonthlyEmission {
            checkers: 0,
            workers: 0,
        },

        // Month 5 (Nov 2025): 20M checkers, 10M workers
        5 => MonthlyEmission {
            checkers: 20_000_000,
            workers: 10_000_000,
        },

        // Months 6-65 (Dec 2025 - May 2031): 1.5M checkers, 3M workers
        6..=65 => MonthlyEmission {
            checkers: 1_500_000,
            workers: 3_000_000,
        },

        // Future months beyond 65: No emissions
        _ => MonthlyEmission {
            checkers: 0,
            workers: 0,
        },
    }
}