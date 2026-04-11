import { v } from 'convex/values';

import {
  budgetConfigSchema,
  piiConfigSchema,
} from '../../lib/shared/schemas/governance';
import { mutation } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { GOVERNANCE_POLICY_TYPES } from './schema';

const policyTypeValidator = v.union(
  ...GOVERNANCE_POLICY_TYPES.map((t) => v.literal(t)),
);

export const upsertPolicy = mutation({
  args: {
    organizationId: v.string(),
    policyType: policyTypeValidator,
    config: v.any(),
  },
  returns: v.id('governancePolicies'),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });
    if (!isAdmin(member.role)) {
      throw new Error('Only admins can modify governance policies');
    }

    if (args.policyType === 'budgets') {
      const parsed = budgetConfigSchema.safeParse(args.config);
      if (!parsed.success) {
        throw new Error(
          `Invalid budget configuration: ${parsed.error.message}`,
        );
      }
    }

    const existing = await ctx.db
      .query('governancePolicies')
      .withIndex('by_org_policyType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('policyType', args.policyType),
      )
      .first();

    let policyId;

    if (existing) {
      await ctx.db.patch(existing._id, {
        config: args.config,
        updatedAt: Date.now(),
        updatedBy: String(authUser._id),
      });
      policyId = existing._id;
    } else {
      policyId = await ctx.db.insert('governancePolicies', {
        organizationId: args.organizationId,
        policyType: args.policyType,
        enabled: true,
        config: args.config,
        updatedAt: Date.now(),
        updatedBy: String(authUser._id),
      });
    }

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: String(authUser._id),
      actorEmail: authUser.email,
      actorType: 'user',
      action: existing ? 'policy.updated' : 'policy.created',
      category: 'security',
      resourceType: 'governance_policy',
      resourceId: String(policyId),
      resourceName: `Policy: ${args.policyType}`,
      newState: { policyType: args.policyType, config: args.config },
      previousState: existing
        ? { policyType: existing.policyType, config: existing.config }
        : undefined,
      status: 'success',
    });

    return policyId;
  },
});

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

    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });
    if (!isAdmin(member.role)) {
      throw new Error('Only admins can modify PII configuration');
    }

    const parsed = piiConfigSchema.safeParse({
      enabled: args.enabled,
      mode: args.mode,
      enabledPatterns: args.enabledPatterns,
      customPatterns: args.customPatterns,
    });
    if (!parsed.success) {
      throw new Error(`Invalid PII configuration: ${parsed.error.message}`);
    }

    const existing = await ctx.db
      .query('governancePolicies')
      .withIndex('by_org_policyType', (q) =>
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
