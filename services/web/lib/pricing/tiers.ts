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

export function enterpriseMonthlyTotal(region: Region, users: number): number {
  return PER_USER_MONTHLY[region] * users;
}
