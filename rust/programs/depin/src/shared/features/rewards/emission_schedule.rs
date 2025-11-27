use depin_core::constants::BMB_MULTIPLIER;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NodeEmissions {
    pub checkers: u64,
    pub workers: u64,
    pub checkers_cumulative: u64,
    pub workers_cumulative: u64,
}

pub fn get_node_emissions(month: u16) -> NodeEmissions {
    match month {
        // Months 0-4 (Jun-Oct 2025): No emissions
        0..=4 => NodeEmissions {
            checkers: 0,
            workers: 0,
            checkers_cumulative: 0,
            workers_cumulative: 0,
        },

        // Month 5 (Nov 2025): 10M checkers, 10M workers (in base units)
        5 => NodeEmissions {
            checkers: 10_000_000 * BMB_MULTIPLIER,
            workers: 10_000_000 * BMB_MULTIPLIER,
            checkers_cumulative: 10_000_000 * BMB_MULTIPLIER,
            workers_cumulative: 10_000_000 * BMB_MULTIPLIER,
        },

        // Months 6-65 (Dec 2025 - May 2031): 1.5M checkers, 3M workers (in base units)
        6..=65 => {
            let months_since_5 = (month - 5) as u64;
            NodeEmissions {
                checkers: 1_500_000 * BMB_MULTIPLIER,
                workers: 3_000_000 * BMB_MULTIPLIER,
                checkers_cumulative: (10_000_000 + (1_500_000 * months_since_5)) * BMB_MULTIPLIER,
                workers_cumulative: (10_000_000 + (3_000_000 * months_since_5)) * BMB_MULTIPLIER,
            }
        },

        // Future months beyond 65: No emissions, cap reached
        _ => NodeEmissions {
            checkers: 0,
            workers: 0,
            checkers_cumulative: (10_000_000 + (1_500_000 * 60)) * BMB_MULTIPLIER, // = 100M in base units
            workers_cumulative: (10_000_000 + (3_000_000 * 60)) * BMB_MULTIPLIER,  // = 190M in base units
        },
    }
}