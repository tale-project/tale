import type { GenericQueryCtx } from 'convex/server';

import type { PolicyType } from '../../lib/shared/schemas/governance';
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
 * Build a period key for the current period.
 * Format: daily=YYYY-MM-DD, weekly=YYYY-Www, monthly=YYYY-MM
 */
export function buildPeriodKey(period: 'daily' | 'weekly' | 'monthly'): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');

  switch (period) {
    case 'daily':
      return `${year}-${month}-${day}`;
    case 'weekly': {
      const jan1 = new Date(Date.UTC(year, 0, 1));
      const dayOfYear =
        Math.floor((now.getTime() - jan1.getTime()) / (24 * 60 * 60 * 1000)) +
        1;
      const weekNum = Math.ceil(dayOfYear / 7);
      return `${year}-W${String(weekNum).padStart(2, '0')}`;
    }
    case 'monthly':
      return `${year}-${month}`;
  }
  return `${year}-${month}`;
}
