import { ConvexError, v } from 'convex/values';

import {
  budgetConfigSchema,
  chatFilterConfigSchema,
  dataNoticeConfigSchema,
  defaultModelsConfigSchema,
  featureFlagsConfigSchema,
  loginPolicyConfigSchema,
  modelAccessConfigSchema,
  moderationProviderConfigSchema,
  passwordPolicyConfigSchema,
  personalizationConfigSchema,
  piiConfigSchema,
  retentionPolicyConfigSchema,
  twoFactorPolicyConfigSchema,
  uploadPolicyConfigSchema,
} from '../../lib/shared/schemas/governance';
import { isRecord } from '../../lib/utils/type-guards';
import { mutation } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import {
  type RetentionCategory,
  RetentionBoundsViolation,
  assertWithinBounds,
} from './retention_floors';
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

/**
 * Detect retention-policy shortening between two config snapshots.
 * Returns a human-readable summary of which categories were reduced,
 * or `null` when nothing was shortened (admin extending or unchanged).
 *
 * "Shortening" is per-category — extending category A while shortening
 * B still triggers the cooldown (the dangerous direction is the one
 * that destroys evidence).
 */
function detectRetentionShortening(
  oldConfig: unknown,
  newConfig: unknown,
): string | null {
  if (!isRecord(oldConfig) || !isRecord(newConfig)) return null;
  const checks: Array<[string, string]> = [
    ['retentionDays', 'documents'],
    ['userTempRetentionHours', 'user temp files'],
    ['agentTempRetentionHours', 'agent temp files'],
    ['chatHistoryRetentionDays', 'chat history'],
    ['auditLogRetentionDays', 'audit log'],
    ['workflowLogRetentionDays', 'workflow logs'],
    ['usageLedgerRetentionDays', 'usage ledger'],
    ['loginAttemptRetentionDays', 'login attempts'],
    ['chatFilterEventsRetentionDays', 'chat filter events'],
    ['promptTemplatesRetentionDays', 'prompt templates'],
    ['messageFeedbackRetentionDays', 'message feedback'],
    ['memoryAuditRetentionDays', 'memory audit'],
    ['customersRetentionDays', 'customers'],
    ['vendorsRetentionDays', 'vendors'],
    ['externalConversationsRetentionDays', 'external conversations'],
    ['messageMetadataRetentionDays', 'message metadata'],
    ['deletionGraceDays', 'deletion grace'],
  ];
  const reduced: string[] = [];
  for (const [key, label] of checks) {
    const oldVal = oldConfig[key];
    const newVal = newConfig[key];
    if (typeof oldVal !== 'number' || typeof newVal !== 'number') continue;
    if (newVal < oldVal) {
      reduced.push(`${label} (${oldVal} → ${newVal})`);
    }
  }
  return reduced.length === 0 ? null : `Reduced: ${reduced.join('; ')}`;
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
      // Env-floor / env-ceiling enforcement: operator-set bounds via
      // `TALE_RETENTION_*_MIN_DAYS` / `_MAX_DAYS` are non-negotiable.
      // Throws RETENTION_BELOW_FLOOR or RETENTION_EXCEEDS_CEILING with
      // structured error data so the UI can render an inline field error
      // pointing at the exact category.
      const cfg = parsed.data;
      const checks: Array<[RetentionCategory, number | undefined]> = [
        ['documents', cfg.retentionDays],
        ['userTempHours', cfg.userTempRetentionHours],
        ['agentTempHours', cfg.agentTempRetentionHours],
        ['chatHistory', cfg.chatHistoryRetentionDays],
        ['auditLog', cfg.auditLogRetentionDays],
        ['workflowLog', cfg.workflowLogRetentionDays],
        ['usageLedger', cfg.usageLedgerRetentionDays],
        ['loginAttempt', cfg.loginAttemptRetentionDays],
        ['chatFilterEvents', cfg.chatFilterEventsRetentionDays],
        ['promptTemplates', cfg.promptTemplatesRetentionDays],
        ['messageFeedback', cfg.messageFeedbackRetentionDays],
        ['memoryAudit', cfg.memoryAuditRetentionDays],
        ['customers', cfg.customersRetentionDays],
        ['vendors', cfg.vendorsRetentionDays],
        ['externalConversations', cfg.externalConversationsRetentionDays],
        ['messageMetadata', cfg.messageMetadataRetentionDays],
      ];
      for (const [cat, val] of checks) {
        if (val === undefined) continue;
        try {
          assertWithinBounds(cat, val);
        } catch (err) {
          if (err instanceof RetentionBoundsViolation) {
            throw new ConvexError({
              code: err.code,
              category: err.category,
              requested: err.requested,
              bound: err.bound,
              source: err.source,
              message: err.message,
            });
          }
          throw err;
        }
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

    if (args.policyType === 'two_factor_policy') {
      const parsed = twoFactorPolicyConfigSchema.safeParse(args.config);
      if (!parsed.success) {
        throw new Error(
          `Invalid two-factor policy configuration: ${parsed.error.message}`,
        );
      }
    }

    if (args.policyType === 'chat_filter') {
      const parsed = chatFilterConfigSchema.safeParse(args.config);
      if (!parsed.success) {
        throw new Error(
          `Invalid chat filter configuration: ${parsed.error.message}`,
        );
      }
    }

    if (args.policyType === 'moderation_provider') {
      const parsed = moderationProviderConfigSchema.safeParse(args.config);
      if (!parsed.success) {
        throw new Error(
          `Invalid moderation provider configuration: ${parsed.error.message}`,
        );
      }
    }

    if (args.policyType === 'personalization') {
      const parsed = personalizationConfigSchema.safeParse(args.config);
      if (!parsed.success) {
        throw new Error(
          `Invalid personalization configuration: ${parsed.error.message}`,
        );
      }
    }

    if (args.policyType === 'data_classification_notice') {
      const parsed = dataNoticeConfigSchema.safeParse(args.config);
      if (!parsed.success) {
        throw new Error(
          `Invalid data classification notice configuration: ${parsed.error.message}`,
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

    // Phase 3 — cooldown on retention shortening.
    //
    // If `retention_policy` is being saved AND any `*RetentionDays`
    // value is being REDUCED, defer the change by writing a row to
    // `retentionPolicyPendingChanges`. Until `appliesAt`, cleanup
    // continues using the OLD config snapshot. After `appliesAt` the
    // pending row is removed and the new config takes effect.
    //
    // This shrinks the operator-as-attacker window: a compromised
    // admin token can no longer immediately destroy evidence by
    // shortening audit retention to its 365-day floor; ops/security
    // teams have a 7-day window to notice + cancel.
    if (
      args.policyType === 'retention_policy' &&
      existing &&
      isRecord(existing.config)
    ) {
      const summary = detectRetentionShortening(existing.config, args.config);
      if (summary) {
        const cooldownMs = 7 * 24 * 60 * 60 * 1000; // 7 days
        await ctx.db.insert('retentionPolicyPendingChanges', {
          organizationId: args.organizationId,
          appliesAt: Date.now() + cooldownMs,
          oldConfig: existing.config,
          newConfig: args.config,
          requestedBy: String(authUser._id),
          requestedAt: Date.now(),
          summary,
        });
        await createAuditLog(ctx, {
          organizationId: args.organizationId,
          actorId: String(authUser._id),
          actorEmail: authUser.email,
          actorType: 'user',
          action: 'policy.retention_shortening_pending',
          category: 'security',
          resourceType: 'governance_policy',
          resourceId: String(existing._id),
          resourceName: 'retention_policy',
          newState: { summary, appliesAt: Date.now() + cooldownMs },
          status: 'success',
        });
        // The new config still gets persisted onto the row so admins see
        // their requested values in the editor, BUT cleanup reads the
        // pending row's `oldConfig` until `appliesAt` (see
        // retention_cleanup.ts).
      }
    }

    // For password_policy, track when rotation first became active so we
    // can grant a grace window (credential expiry is computed off the
    // later of account.passwordChangedAt and policy.effectiveAt).
    const nextEffectiveAt = computeNextEffectiveAt(
      args.policyType,
      args.config,
      existing?.config,
    );

    // Mirror `config.enabled` (when present) to the top-level `enabled`
    // column so reads from either side agree. The bespoke mutations this
    // replaced (e.g. `upsertPiiConfig`) took `enabled` as a separate arg
    // and wrote it at the top level; the UI still reads
    // `policy.enabled ?? config.enabled`, so without this mirror the
    // admin toggle silently fails to persist across reloads.
    const configEnabled =
      isRecord(args.config) && typeof args.config.enabled === 'boolean'
        ? args.config.enabled
        : undefined;

    let policyId;

    if (existing) {
      await ctx.db.patch(existing._id, {
        config: args.config,
        updatedAt: Date.now(),
        updatedBy: String(authUser._id),
        ...(configEnabled !== undefined ? { enabled: configEnabled } : {}),
        ...(nextEffectiveAt !== undefined
          ? { effectiveAt: nextEffectiveAt }
          : {}),
      });
      policyId = existing._id;
    } else {
      policyId = await ctx.db.insert('governancePolicies', {
        organizationId: args.organizationId,
        policyType: args.policyType,
        enabled: configEnabled ?? true,
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

/**
 * Cancel a pending retention-shortening before it takes effect.
 * Admin-only. After this the new (shortened) values that were saved
 * onto the policy row are reverted to the snapshot's `oldConfig`.
 */
export const cancelPendingRetentionChange = mutation({
  args: {
    organizationId: v.string(),
    pendingId: v.id('retentionPolicyPendingChanges'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'unauthenticated',
        message: 'Sign in required.',
      });
    }
    const callerId = String(authUser._id);
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: callerId,
      email: authUser.email ?? '',
    });
    if (!isAdmin(member.role)) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only admins can cancel pending retention changes.',
      });
    }

    const pending = await ctx.db.get(args.pendingId);
    if (!pending || pending.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Pending change does not exist.',
      });
    }

    // Revert the policy row to the snapshot's oldConfig.
    const policyRow = await ctx.db
      .query('governancePolicies')
      .withIndex('by_org_policyType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('policyType', 'retention_policy'),
      )
      .first();
    if (policyRow) {
      await ctx.db.patch(policyRow._id, {
        config: pending.oldConfig,
        updatedAt: Date.now(),
        updatedBy: callerId,
      });
    }
    await ctx.db.delete(args.pendingId);

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: callerId,
      actorEmail: authUser.email ?? '',
      actorType: 'user',
      action: 'policy.retention_shortening_cancelled',
      category: 'security',
      resourceType: 'governance_policy',
      resourceId: String(args.pendingId),
      resourceName: 'retention_policy',
      newState: { summary: pending.summary },
      status: 'success',
    });

    return null;
  },
});
