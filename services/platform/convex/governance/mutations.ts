import { v } from 'convex/values';

import {
  auditRetentionConfigSchema,
  budgetConfigSchema,
  defaultModelsConfigSchema,
  featureFlagsConfigSchema,
  loginPolicyConfigSchema,
  modelAccessConfigSchema,
  passwordPolicyConfigSchema,
  piiConfigSchema,
  retentionPolicyConfigSchema,
  uploadPolicyConfigSchema,
} from '../../lib/shared/schemas/governance';
import { isRecord } from '../../lib/utils/type-guards';
import { mutation } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { GOVERNANCE_POLICY_TYPES } from './schema';

const policyTypeValidator = v.union(
  ...GOVERNANCE_POLICY_TYPES.map((t) => v.literal(t)),
);

// Decides whether to set/update `effectiveAt` on a policy row. Returns:
// - a number to patch (rotation just activated — first enablement wins)
// - `undefined` to leave the existing value untouched
//
// Rotation semantics: every time `rotationDays` transitions from 0 to a
// positive value, stamp `effectiveAt = now` so affected users get a full
// grace window. Unrelated edits (e.g. tweaking minLength while rotation
// stays enabled) preserve the original timestamp so the grace window
// doesn't reset.
function readRotationDays(config: unknown): number {
  if (!isRecord(config)) return 0;
  const value = config.rotationDays;
  return typeof value === 'number' ? value : 0;
}

function computeNextEffectiveAt(
  policyType: string,
  nextConfig: unknown,
  prevConfig: unknown,
): number | undefined {
  if (policyType !== 'password_policy') return undefined;
  const next = readRotationDays(nextConfig);
  const prev = readRotationDays(prevConfig);
  if (next > 0 && prev === 0) {
    return Date.now();
  }
  return undefined;
}

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

    if (args.policyType === 'default_models') {
      const parsed = defaultModelsConfigSchema.safeParse(args.config);
      if (!parsed.success) {
        throw new Error(
          `Invalid default models configuration: ${parsed.error.message}`,
        );
      }
    }

    if (args.policyType === 'upload_policy') {
      const parsed = uploadPolicyConfigSchema.safeParse(args.config);
      if (!parsed.success) {
        throw new Error(
          `Invalid upload policy configuration: ${parsed.error.message}`,
        );
      }
    }

    if (args.policyType === 'pii_config') {
      const parsed = piiConfigSchema.safeParse(args.config);
      if (!parsed.success) {
        throw new Error(`Invalid PII configuration: ${parsed.error.message}`);
      }
    }

    if (args.policyType === 'feature_flags') {
      const parsed = featureFlagsConfigSchema.safeParse(args.config);
      if (!parsed.success) {
        throw new Error(
          `Invalid feature flags configuration: ${parsed.error.message}`,
        );
      }
    }

    if (args.policyType === 'retention_policy') {
      const parsed = retentionPolicyConfigSchema.safeParse(args.config);
      if (!parsed.success) {
        throw new Error(
          `Invalid retention policy configuration: ${parsed.error.message}`,
        );
      }
    }

    if (args.policyType === 'model_access') {
      const parsed = modelAccessConfigSchema.safeParse(args.config);
      if (!parsed.success) {
        throw new Error(
          `Invalid model access configuration: ${parsed.error.message}`,
        );
      }
    }

    if (args.policyType === 'audit_retention') {
      const parsed = auditRetentionConfigSchema.safeParse(args.config);
      if (!parsed.success) {
        throw new Error(
          `Invalid audit retention configuration: ${parsed.error.message}`,
        );
      }
    }

    if (args.policyType === 'login_policy') {
      const parsed = loginPolicyConfigSchema.safeParse(args.config);
      if (!parsed.success) {
        throw new Error(
          `Invalid login policy configuration: ${parsed.error.message}`,
        );
      }
    }

    if (args.policyType === 'password_policy') {
      const parsed = passwordPolicyConfigSchema.safeParse(args.config);
      if (!parsed.success) {
        throw new Error(
          `Invalid password policy configuration: ${parsed.error.message}`,
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

    // For password_policy, track when rotation first became active so we
    // can grant a grace window (credential expiry is computed off the
    // later of account.passwordChangedAt and policy.effectiveAt).
    const nextEffectiveAt = computeNextEffectiveAt(
      args.policyType,
      args.config,
      existing?.config,
    );

    let policyId;

    if (existing) {
      await ctx.db.patch(existing._id, {
        config: args.config,
        updatedAt: Date.now(),
        updatedBy: String(authUser._id),
        ...(nextEffectiveAt !== undefined
          ? { effectiveAt: nextEffectiveAt }
          : {}),
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
        ...(nextEffectiveAt !== undefined
          ? { effectiveAt: nextEffectiveAt }
          : {}),
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
