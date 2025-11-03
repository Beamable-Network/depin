use super::BMB_PER_POINT;

/// Calculates addon pool points based on checker count and total stake
///
/// Points are used for addon pool reward distribution. A user earns points
/// based on the minimum of:
/// 1. Their checker license count
/// 2. Their total stake divided by BMB_PER_POINT (2500 BMB per point)
///
/// This ensures users must stake sufficient BMB to "activate" each checker license.
///
/// # Arguments
/// * `checker_count` - Number of checker licenses the user owns
/// * `total_stake` - Total BMB staked by the user
///
/// # Returns
/// * The number of points earned (min of checker_count and stake-based points)
///
/// # Examples
/// ```
/// use worker_stake::utils::calculate_points;
///
/// // User has 3 licenses and 7500 BMB staked
/// // 7500 / 2500 = 3 points from stake
/// // min(3, 3) = 3 points
/// let points = calculate_points(3, 7_500 * 10_u64.pow(9));
/// assert_eq!(points, 3);
///
/// // User has 5 licenses but only 10000 BMB staked
/// // 10000 / 2500 = 4 points from stake
/// // min(5, 4) = 4 points (capped by stake)
/// let points = calculate_points(5, 10_000 * 10_u64.pow(9));
/// assert_eq!(points, 4);
///
/// // User has 2 licenses but 10000 BMB staked
/// // 10000 / 2500 = 4 points from stake
/// // min(2, 4) = 2 points (capped by licenses)
/// let points = calculate_points(2, 10_000 * 10_u64.pow(9));
/// assert_eq!(points, 2);
/// ```
pub fn calculate_points(checker_count: u16, total_stake: u64) -> u64 {
    std::cmp::min(checker_count as u64, total_stake / BMB_PER_POINT)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bmb(amount: u64) -> u64 {
        amount * (BMB_PER_POINT / 2_500)
    }

    #[test]
    fn test_calculate_points_balanced() {
        // Exactly enough stake for all licenses
        assert_eq!(calculate_points(3, bmb(7_500)), 3);
        assert_eq!(calculate_points(1, bmb(2_500)), 1);
        assert_eq!(calculate_points(10, bmb(25_000)), 10);
    }

    #[test]
    fn test_calculate_points_capped_by_licenses() {
        // More stake than needed, capped by license count
        assert_eq!(calculate_points(2, bmb(10_000)), 2);
        assert_eq!(calculate_points(1, bmb(5_000)), 1);
    }

    #[test]
    fn test_calculate_points_capped_by_stake() {
        // More licenses than stake supports
        assert_eq!(calculate_points(5, bmb(10_000)), 4);
        assert_eq!(calculate_points(10, bmb(12_500)), 5);
    }

    #[test]
    fn test_calculate_points_insufficient_stake() {
        // Not enough stake for even one license
        assert_eq!(calculate_points(3, bmb(2_000)), 0);
        assert_eq!(calculate_points(5, bmb(1_000)), 0);
    }

    #[test]
    fn test_calculate_points_no_licenses() {
        // No licenses means no points
        assert_eq!(calculate_points(0, bmb(10_000)), 0);
        assert_eq!(calculate_points(0, 0), 0);
    }
}
