import type { GenericQueryCtx } from 'convex/server';

import { isRecord } from '../../lib/utils/type-guards';
import type { DataModel } from '../_generated/dataModel';

/**
 * Check whether the personalization v1 feature is enabled for an org by
 * inspecting the `feature_flags` governance policy.
 *
 * Convention: the policy's `config` carries a `personalization_v1: true`
 * field (alongside the existing rules array). Absence → false (default-off,
 * matching the v1 rollout plan: orgs must explicitly opt in).
 *
 * Reading directly here instead of going through `resolveFeatureFlags`
 * avoids polluting the typed `FeatureFlagsConfig` schema with a one-off
 * boolean. v2 may promote this to its own policy type once the wider
 * personalization config (residency / providers / piiClasses) lands.
 */
export async function isPersonalizationEnabled(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
): Promise<boolean> {
  const policy = await ctx.db
    .query('governancePolicies')
    .withIndex('by_org_policyType', (q) =>
      q.eq('organizationId', organizationId).eq('policyType', 'feature_flags'),
    )
    .first();

  if (!policy || policy.enabled === false) return false;
  const config = policy.config;
  if (!isRecord(config)) return false;
  return config['personalization_v1'] === true;
}
