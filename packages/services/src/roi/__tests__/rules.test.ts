import { describe, expect, it } from 'vitest';

import { evaluateRules, RULE_THRESHOLDS } from '../rules.js';

const baseline = {
  roi: 0.5,
  rpm: 5,
  pv: 5000,
  revenue: 100,
  revenuePrev: 100,
  windowDays: 30,
};

describe('evaluateRules', () => {
  it('returns no flags when every metric is healthy', () => {
    expect(evaluateRules(baseline)).toEqual([]);
  });

  describe('negative_roi', () => {
    it('fires when ROI < 0', () => {
      expect(evaluateRules({ ...baseline, roi: -0.01 })).toContain('negative_roi');
    });

    it('does NOT fire when ROI === 0 (boundary)', () => {
      expect(evaluateRules({ ...baseline, roi: 0 })).not.toContain('negative_roi');
    });

    it('does NOT fire when ROI is null (no cost data)', () => {
      expect(evaluateRules({ ...baseline, roi: null })).not.toContain('negative_roi');
    });
  });

  describe('low_rpm', () => {
    it('fires when pv > 1000 AND rpm < 0.5', () => {
      expect(evaluateRules({ ...baseline, pv: 1001, rpm: 0.49 })).toContain('low_rpm');
    });

    it('does NOT fire at pv === 1000 boundary', () => {
      expect(evaluateRules({ ...baseline, pv: RULE_THRESHOLDS.pvFloor, rpm: 0.1 })).not.toContain(
        'low_rpm',
      );
    });

    it('does NOT fire when rpm === 0.5 boundary', () => {
      expect(evaluateRules({ ...baseline, pv: 5000, rpm: RULE_THRESHOLDS.rpmFloor })).not.toContain(
        'low_rpm',
      );
    });

    it('does NOT fire when rpm is null (no PV data)', () => {
      expect(evaluateRules({ ...baseline, pv: 5000, rpm: null })).not.toContain('low_rpm');
    });
  });

  describe('declining_revenue', () => {
    it('fires when revenue dropped >= 30% over a >=14-day window', () => {
      expect(
        evaluateRules({
          ...baseline,
          windowDays: 14,
          revenue: 70,
          revenuePrev: 100,
        }),
      ).toContain('declining_revenue');
    });

    it('does NOT fire at the 30% boundary (29.9% drop is fine)', () => {
      expect(
        evaluateRules({
          ...baseline,
          windowDays: 30,
          revenue: 70.1,
          revenuePrev: 100,
        }),
      ).not.toContain('declining_revenue');
    });

    it('does NOT fire for short windows (< 14 days)', () => {
      expect(
        evaluateRules({
          ...baseline,
          windowDays: 13,
          revenue: 0,
          revenuePrev: 100,
        }),
      ).not.toContain('declining_revenue');
    });

    it('does NOT fire when prev was zero (no baseline)', () => {
      expect(evaluateRules({ ...baseline, revenue: 0, revenuePrev: 0 })).not.toContain(
        'declining_revenue',
      );
    });
  });

  it('returns multiple flags when several rules trigger', () => {
    const flags = evaluateRules({
      roi: -0.5,
      rpm: 0.1,
      pv: 5000,
      revenue: 10,
      revenuePrev: 100,
      windowDays: 30,
    });
    expect(flags).toEqual(['negative_roi', 'low_rpm', 'declining_revenue']);
  });

  it('handles non-finite inputs defensively', () => {
    expect(
      evaluateRules({
        ...baseline,
        roi: Number.NaN,
        rpm: Number.POSITIVE_INFINITY,
      }),
    ).toEqual([]);
  });
});
