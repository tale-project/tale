import type { GenericQueryCtx } from 'convex/server';
import { v } from 'convex/values';

import {
  DEFAULT_DSAR_GOVERNANCE,
  type DsarGovernanceConfig,
  dsarGovernanceConfigSchema,
} from '../../lib/shared/schemas/governance';
import type { DataModel } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { authComponent } from '../auth';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

/**
 * Read the per-org `dsar_governance` policy. Returns the parsed config
 * (falling back to defaults when the row is absent or its config does
 * not parse). Mirrors `getPasswordPolicyRow` in `governance/helpers.ts`.
 *
 * Defaults: 24h cooling-off, no dual approval, 5 requests/admin/day.
 *
 * The mutation `governance.mutations.upsertPolicy` (with policyType =
 * 'dsar_governance') is the write path; it Zod-validates against
 * `dsarGovernanceConfigSchema` before persisting and writes an audit
 * log entry for the change.
 */
export async function getDsarPolicy(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
): Promise<DsarGovernanceConfig> {
  const row = await ctx.db
    .query('governancePolicies')
    .withIndex('by_org_policyType', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('policyType', 'dsar_governance'),
    )
    .first();

  if (!row) return DEFAULT_DSAR_GOVERNANCE;

  const parsed = dsarGovernanceConfigSchema.safeParse(row.config);
  if (!parsed.success) {
    console.warn(
      `Invalid dsar_governance config for org ${organizationId}; using defaults`,
      parsed.error,
    );
    return DEFAULT_DSAR_GOVERNANCE;
  }

  return parsed.data;
}

/**
 * Public admin-gated query for the DSR policy config page. Returns the
 * parsed config (defaults applied), so the UI never has to know whether
 * a row exists yet. Required for `useDsarPolicy` in the dsar-policy
 * settings page.
 */
export const getDsarPolicyForUi = query({
  args: { organizationId: v.string() },
  returns: v.object({
    coolingOffHours: v.number(),
    requireDualApproval: v.boolean(),
    dailyLimitPerAdmin: v.number(),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });
    if (!isAdmin(member.role)) {
      throw new Error('Reading dsar_governance requires admin role.');
    }
    return await getDsarPolicy(ctx, args.organizationId);
  },
});
