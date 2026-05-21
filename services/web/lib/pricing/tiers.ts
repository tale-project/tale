import type { Region } from '@/lib/pricing/region';

/**
 * Per-region monthly cost of one Enterprise seat (in the region's
 * currency — see `REGION_CURRENCY`).
 */
export const PER_USER_MONTHLY: Record<Region, number> = { CH: 12, DE: 14 };

/**
 * Per-region monthly cost of one TB of storage add-on.
 */
export const STORAGE_PER_TB_MONTHLY: Record<Region, number> = {
  CH: 10,
  DE: 12,
};

export const DEFAULT_USERS = 25;

export type Billing = 'monthly' | 'yearly';

/**
 * Discount applied to the yearly billing toggle. Mirrors the "2 months
 * free" footnote on the pricing card — yearly customers pay 10 months
 * of monthly rate, then divide back to a per-month displayed figure.
 */
export const YEARLY_DISCOUNT_FACTOR = 10 / 12;

/**
 * Effective monthly seat cost for the chosen billing cadence. Yearly
 * customers see 10/12 of the monthly rate so the "× users × 12 months"
 * total honors the "2 months free" footnote (audit finding R2-B12: the
 * displayed monthly price was previously identical for both toggles
 * while the footnote claimed savings — misleading users).
 */
export function effectivePerUserMonthly(
  region: Region,
  billing: Billing,
): number {
  const base = PER_USER_MONTHLY[region];
  return billing === 'yearly' ? base * YEARLY_DISCOUNT_FACTOR : base;
}

export function enterpriseMonthlyTotal(
  region: Region,
  users: number,
  billing: Billing = 'monthly',
): number {
  return effectivePerUserMonthly(region, billing) * users;
}
