/**
 * Low-efficiency rules for the ROI dashboard.
 *
 * Pure function so the worker, the dashboard, and any future Agent can
 * agree on which sites are "needs attention" without re-running SQL.
 *
 * Rules (v0; thresholds intentionally hard-coded — see TODO):
 *
 *   1. `negative_roi`     — `roi !== null && roi < 0` (cost > revenue)
 *   2. `low_rpm`          — `pv > 1000` and `rpm !== null && rpm < 0.5`
 *   3. `declining_revenue`— window >= 14 days, prev-window had revenue,
 *                           and current revenue dropped >= 30 %
 *
 * The function returns *all* matching flags so the UI can show e.g.
 * "negative_roi · low_rpm" simultaneously.
 *
 * TODO: make configurable via `settings` once T26 lands.
 */

export const LOW_EFFICIENCY_FLAGS = ['negative_roi', 'low_rpm', 'declining_revenue'] as const;
export type LowEfficiencyFlag = (typeof LOW_EFFICIENCY_FLAGS)[number];

export type EvaluateRulesInput = {
  /** ROI ratio in [-1, +∞) or null when totalCost == 0. */
  roi: number | null;
  /** Revenue per 1k page-views; null when pv == 0. */
  rpm: number | null;
  pv: number;
  revenue: number;
  revenuePrev: number;
  /** Inclusive day count of the current window. */
  windowDays: number;
};

// Hard-coded thresholds. TODO: make configurable.
export const RULE_THRESHOLDS = {
  /** RPM under this fires `low_rpm`. */
  rpmFloor: 0.5,
  /** PV must be above this for `low_rpm` to fire (filter out low-traffic noise). */
  pvFloor: 1000,
  /** Decline ratio (current/prev) under (1 - this) fires `declining_revenue`. */
  declineRatio: 0.3,
  /** Minimum window size for `declining_revenue` to be meaningful. */
  minWindowDays: 14,
} as const;

/**
 * Evaluate the rule set for a single site/window. Order of returned
 * flags matches `LOW_EFFICIENCY_FLAGS` so callers can rely on stable
 * ordering for UI grouping.
 */
export function evaluateRules(input: EvaluateRulesInput): LowEfficiencyFlag[] {
  const flags: LowEfficiencyFlag[] = [];

  // 1. negative_roi — fires only when ROI is computable and strictly negative.
  if (input.roi !== null && Number.isFinite(input.roi) && input.roi < 0) {
    flags.push('negative_roi');
  }

  // 2. low_rpm — needs both a meaningful PV (> floor) and a low RPM.
  if (
    input.pv > RULE_THRESHOLDS.pvFloor &&
    input.rpm !== null &&
    Number.isFinite(input.rpm) &&
    input.rpm < RULE_THRESHOLDS.rpmFloor
  ) {
    flags.push('low_rpm');
  }

  // 3. declining_revenue — only meaningful for a >=14-day window with
  //    non-zero prior-window revenue.
  if (
    input.windowDays >= RULE_THRESHOLDS.minWindowDays &&
    input.revenuePrev > 0 &&
    input.revenue >= 0
  ) {
    const dropRatio = (input.revenuePrev - input.revenue) / input.revenuePrev;
    if (dropRatio >= RULE_THRESHOLDS.declineRatio) {
      flags.push('declining_revenue');
    }
  }

  return flags;
}
