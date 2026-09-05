import {
  DEFAULT_TWO_FACTOR_POLICY,
  type TwoFactorPolicyConfig,
} from '../../../lib/shared/schemas/governance';

/**
 * Resolve the strictest two-factor policy across all of a user's orgs.
 * Merge rule: enforcement wins (OR across orgs), shortest positive grace
 * wins, exemption requires unanimous agreement.
 */
export function mergeStrictestTwoFactorPolicy(
  policies: readonly TwoFactorPolicyConfig[],
): TwoFactorPolicyConfig {
  if (policies.length === 0) return { ...DEFAULT_TWO_FACTOR_POLICY };
  return policies.reduce(
    (acc, p) => ({
      enforced: acc.enforced || p.enforced,
      gracePeriodDays: Math.min(acc.gracePeriodDays, p.gracePeriodDays),
      exemptSsoUsers: acc.exemptSsoUsers && p.exemptSsoUsers,
    }),
    policies[0],
  );
}

/**
 * Build a period key for the current time.
 * Format: daily=YYYY-MM-DD, weekly=YYYY-Www, monthly=YYYY-MM
 *
 * Uses `new Date()` internally — prefer `buildPeriodKeyFromTimestamp`
 * in mutations to avoid non-determinism on retry.
 */
export function buildPeriodKey(period: 'daily' | 'weekly' | 'monthly'): string {
  return buildPeriodKeyFromTimestamp(period, Date.now());
}

/**
 * Build a period key from an explicit timestamp (milliseconds since epoch).
 * Deterministic — safe for use inside Convex mutations.
 */
export function buildPeriodKeyFromTimestamp(
  period: 'daily' | 'weekly' | 'monthly',
  timestamp: number,
): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  switch (period) {
    case 'daily':
      return `${year}-${month}-${day}`;
    case 'weekly': {
      // ISO 8601: the week-year is the year of the Thursday in that week.
      // Shift the date to the Thursday of its ISO week, then count weeks
      // from the Thursday of the reference week that contains Jan 4.
      const target = new Date(
        Date.UTC(year, date.getUTCMonth(), date.getUTCDate()),
      );
      const dayNr = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
      target.setUTCDate(target.getUTCDate() - dayNr + 3);
      const isoYear = target.getUTCFullYear();
      const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
      firstThursday.setUTCDate(
        firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3,
      );
      const weekNum =
        1 +
        Math.round(
          (target.getTime() - firstThursday.getTime()) /
            (7 * 24 * 60 * 60 * 1000),
        );
      return `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
    }
    case 'monthly':
      return `${year}-${month}`;
    default:
      return `${year}-${month}-${day}`;
  }
}
