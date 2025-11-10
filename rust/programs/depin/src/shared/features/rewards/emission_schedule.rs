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

        // Month 5 (Nov 2025): 20M checkers, 10M workers
        5 => NodeEmissions {
            checkers: 20_000_000,
            workers: 10_000_000,
            checkers_cumulative: 20_000_000,
            workers_cumulative: 10_000_000,
        },

        // Months 6-65 (Dec 2025 - May 2031): 1.5M checkers, 3M workers
        6..=65 => {
            let months_since_5 = (month - 5) as u64;
            NodeEmissions {
                checkers: 1_500_000,
                workers: 3_000_000,
                checkers_cumulative: 20_000_000 + (1_500_000 * months_since_5),
                workers_cumulative: 10_000_000 + (3_000_000 * months_since_5),
            }
        },

        // Future months beyond 65: No emissions, cap reached
        _ => NodeEmissions {
            checkers: 0,
            workers: 0,
            checkers_cumulative: 20_000_000 + (1_500_000 * 60), // = 110M
            workers_cumulative: 10_000_000 + (3_000_000 * 60),  // = 190M
        },
    }
}