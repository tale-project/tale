import type { GenericQueryCtx } from 'convex/server';

import {
  DEFAULT_PASSWORD_POLICY,
  mergeStrictestPasswordPolicy,
  type PasswordPolicyConfig,
  passwordPolicyConfigSchema,
  type PolicyType,
} from '../../lib/shared/schemas/governance';
import { isRecord } from '../../lib/utils/type-guards';
import type { DataModel } from '../_generated/dataModel';

/**
 * Read a governance policy config for a given organization and type.
 * Returns the config object or null if no policy exists.
 */
export async function readPolicyConfig<T>(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
  policyType: PolicyType,
): Promise<T | null> {
  const policy = await ctx.db
    .query('governancePolicies')
    .withIndex('by_org_policyType', (q) =>
      q.eq('organizationId', organizationId).eq('policyType', policyType),
    )
    .first();

  if (!policy) {
    return null;
  }

  const config: unknown = policy.config;
  if (!isRecord(config)) {
    return null;
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- config is validated at write time via Zod schemas
  return config as T;
}

/**
 * Load the governance policies row for password_policy and return both
 * the parsed config (falling back to defaults when absent or malformed)
 * and the row's `effectiveAt` timestamp (used by rotation to grant a
 * grace window on first activation).
 */
export async function getPasswordPolicyRow(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
): Promise<{ policy: PasswordPolicyConfig; effectiveAt: number | null }> {
  const row = await ctx.db
    .query('governancePolicies')
    .withIndex('by_org_policyType', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('policyType', 'password_policy'),
    )
    .first();

  if (!row) {
    return { policy: DEFAULT_PASSWORD_POLICY, effectiveAt: null };
  }

  const parsed = passwordPolicyConfigSchema.safeParse(row.config);
  if (!parsed.success) {
    console.warn(
      `Invalid password_policy config for org ${organizationId}; using defaults`,
      parsed.error,
    );
    return {
      policy: DEFAULT_PASSWORD_POLICY,
      effectiveAt: row.effectiveAt ?? null,
    };
  }

  return { policy: parsed.data, effectiveAt: row.effectiveAt ?? null };
}

export async function getPasswordPolicy(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
): Promise<PasswordPolicyConfig> {
  return (await getPasswordPolicyRow(ctx, organizationId)).policy;
}

/**
 * Resolve the effective password policy for a user across every org
 * they belong to (strictest-wins), along with the earliest rotation
 * `effectiveAt` across those orgs. For a single-org deployment this
 * collapses to the one org's policy.
 */
export async function getStrictestPasswordPolicyForUser(
  ctx: GenericQueryCtx<DataModel>,
  organizationIds: readonly string[],
): Promise<{ policy: PasswordPolicyConfig; effectiveAt: number | null }> {
  if (organizationIds.length === 0) {
    return { policy: DEFAULT_PASSWORD_POLICY, effectiveAt: null };
  }
  const rows = await Promise.all(
    organizationIds.map((id) => getPasswordPolicyRow(ctx, id)),
  );
  const policy = mergeStrictestPasswordPolicy(rows.map((r) => r.policy));
  const effectiveAts = rows
    .map((r) => r.effectiveAt)
    .filter((x): x is number => typeof x === 'number');
  const effectiveAt =
    effectiveAts.length === 0 ? null : Math.min(...effectiveAts);
  return { policy, effectiveAt };
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
      const jan1 = new Date(Date.UTC(year, 0, 1));
      const dayOfYear =
        Math.floor((date.getTime() - jan1.getTime()) / (24 * 60 * 60 * 1000)) +
        1;
      const weekNum = Math.ceil(dayOfYear / 7);
      return `${year}-W${String(weekNum).padStart(2, '0')}`;
    }
    case 'monthly':
      return `${year}-${month}`;
    default:
      return `${year}-${month}-${day}`;
  }
}
