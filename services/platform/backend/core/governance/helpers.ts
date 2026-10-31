import {
  DEFAULT_TWO_FACTOR_POLICY,
  type TwoFactorPolicyConfig,
} from '@tale/shared/schemas/governance';

/**
 * Resolve the strictest two-factor policy across a user's orgs. Only the
 * orgs that require a second factor take part: across them the shortest
 * grace wins (0 included, which blocks at once) and SSO-only users are
 * exempt only when every one of them exempts them. An org that requires
 * nothing shortens no grace and lifts no exemption; when none requires
 * one, nothing is asked (the default policy).
 */
export function mergeStrictestTwoFactorPolicy(
  policies: readonly TwoFactorPolicyConfig[],
): TwoFactorPolicyConfig {
  const enforcing = policies.filter((policy) => policy.enforced);
  if (enforcing.length === 0) return { ...DEFAULT_TWO_FACTOR_POLICY };
  return enforcing.reduce(
    (acc, p) => ({
      enforced: true,
      gracePeriodDays: Math.min(acc.gracePeriodDays, p.gracePeriodDays),
      exemptSsoUsers: acc.exemptSsoUsers && p.exemptSsoUsers,
    }),
    enforcing[0],
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

/**
 * The instant (milliseconds since epoch) the period containing `timestamp`
 * ends: the next UTC boundary — midnight, Monday midnight (ISO weeks), or the
 * first of the month — where `buildPeriodKeyFromTimestamp` rolls to a new key
 * and every cap measured over the ledger starts again from zero.
 */
export function buildPeriodEndFromTimestamp(
  period: 'daily' | 'weekly' | 'monthly',
  timestamp: number,
): number {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  switch (period) {
    case 'weekly': {
      const daysSinceMonday = (date.getUTCDay() + 6) % 7;
      return Date.UTC(year, month, day - daysSinceMonday + 7);
    }
    case 'monthly':
      return Date.UTC(year, month + 1, 1);
    case 'daily':
    default:
      return Date.UTC(year, month, day + 1);
  }
}
