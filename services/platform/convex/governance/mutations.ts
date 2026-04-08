import { v } from 'convex/values';

import { mutation } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { authComponent } from '../auth';

export const upsertPiiConfig = mutation({
  args: {
    organizationId: v.string(),
    enabled: v.boolean(),
    mode: v.union(v.literal('mask'), v.literal('block')),
    enabledPatterns: v.array(v.string()),
    customPatterns: v.optional(
      v.array(
        v.object({
          name: v.string(),
          regex: v.string(),
          replacement: v.string(),
        }),
      ),
    ),
  },
  returns: v.id('governancePolicies'),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const existing = await ctx.db
      .query('governancePolicies')
      .withIndex('by_org_and_type', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('policyType', 'pii_config'),
      )
      .first();

    const config = {
      mode: args.mode,
      enabledPatterns: args.enabledPatterns,
      customPatterns: args.customPatterns,
    };

    let policyId;

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        config,
        updatedAt: Date.now(),
        updatedBy: String(authUser._id),
      });
      policyId = existing._id;
    } else {
      policyId = await ctx.db.insert('governancePolicies', {
        organizationId: args.organizationId,
        policyType: 'pii_config',
        enabled: args.enabled,
        config,
        updatedAt: Date.now(),
        updatedBy: String(authUser._id),
      });
    }

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: String(authUser._id),
      actorEmail: authUser.email,
      actorType: 'user',
      action: existing ? 'pii_config.updated' : 'pii_config.created',
      category: 'security',
      resourceType: 'governance_policy',
      resourceId: String(policyId),
      resourceName: 'PII configuration',
      newState: { enabled: args.enabled, ...config },
      previousState: existing
        ? { enabled: existing.enabled, ...existing.config }
        : undefined,
      status: 'success',
    });

    return policyId;
  },
});
