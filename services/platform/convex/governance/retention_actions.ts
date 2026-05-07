/**
 * Public V8 actions for retention bounds. Replace the deleted
 * `getEffectiveRetentionBounds` query and the retention branch of
 * `upsertPolicy` mutation. V8 runtime (no `'use node'`) — file IO is
 * delegated to `internal.lib.config_store.actions` via `ctx.runAction`.
 *
 * Why actions and not a query:
 *   - Bounds live in `$TALE_CONFIG_DIR/retention/{orgSlug}.json`. V8
 *     queries/mutations cannot read fs and cannot await a Node action
 *     inline. Only V8 actions can `ctx.runAction(internal nodeAction)`.
 *   - Bounds change rarely (operator edits the file or env), so losing
 *     query reactivity is acceptable. The frontend uses TanStack Query
 *     to one-shot fetch on editor open.
 */

import { ConvexError, v } from 'convex/values';

import type {
  RetentionCategory,
  RetentionDefaultsConfig,
} from '../../lib/shared/schemas/retention';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import {
  RetentionBoundsViolation,
  RetentionConfigMissingError,
  applyEnvTighteningAll,
  assertWithinBounds,
  buildBoundsByCategory,
  isRetentionDisabled,
} from './retention_floors';

/**
 * Load the per-org retention config, falling back to the `default`
 * org's file when the org-specific file is absent. Returns `null` if
 * neither exists; callers throw a config-missing error then.
 */
async function loadOrgRetentionConfig(
  ctx: ActionCtx,
  orgSlug: string,
): Promise<RetentionDefaultsConfig | null> {
  const own = await ctx.runAction(
    internal.lib.config_store.actions.readRetentionConfig,
    { orgSlug },
  );
  if (own) return own;
  if (orgSlug === 'default') return null;
  return ctx.runAction(internal.lib.config_store.actions.readRetentionConfig, {
    orgSlug: 'default',
  });
}

/**
 * Effective retention bounds (min + max + default) for every category,
 * including any operator env-var tightening on top of the file values.
 *
 * Replaces the deleted `getEffectiveRetentionBounds` query. The editor
 * uses this to render `<input min={N} max={M}>` plus helper text BEFORE
 * the user types something out-of-range, so they never get the "you
 * tried 365 days but operator caps at 100" toast — the input refuses.
 *
 * Open to any org member; bounds are operator-set, not org-secret.
 */
const envBindingValidator = v.object({
  envName: v.string(),
  source: v.union(v.literal('metadata'), v.literal('none')),
  applied: v.boolean(),
});

const metadataValidator = v.optional(
  v.object({
    label: v.optional(v.string()),
    help: v.optional(v.string()),
    order: v.optional(v.number()),
    hidden: v.optional(v.boolean()),
  }),
);

export const getRetentionBoundsAction = action({
  args: { organizationId: v.string() },
  returns: v.object({
    bounds: v.array(
      v.object({
        category: v.string(),
        min: v.number(),
        max: v.number(),
        default: v.number(),
        unit: v.union(v.literal('days'), v.literal('hours')),
        source: v.union(v.literal('file'), v.literal('env')),
        minEnv: envBindingValidator,
        maxEnv: envBindingValidator,
        defaultEnv: envBindingValidator,
        metadata: metadataValidator,
      }),
    ),
    retentionDisabled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'unauthenticated',
        message: 'Sign in required.',
      });
    }
    await ctx.runQuery(internal.governance.internal_queries.verifyOrgMember, {
      organizationId: args.organizationId,
      userId: String(authUser._id),
      email: authUser.email ?? '',
      name: authUser.name,
    });

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const orgConfig = await loadOrgRetentionConfig(ctx, orgSlug);
    if (!orgConfig) {
      throw new ConvexError({
        code: 'RETENTION_CONFIG_MISSING',
        message:
          'Retention config not yet installed. Copy examples/retention/default.json to $TALE_CONFIG_DIR/retention/default.json then reload.',
      });
    }

    let bounds;
    try {
      bounds = applyEnvTighteningAll(orgConfig);
    } catch (err) {
      if (err instanceof RetentionConfigMissingError) {
        throw new ConvexError({
          code: 'RETENTION_CONFIG_MISSING',
          category: err.category,
          message: err.message,
        });
      }
      throw err;
    }

    return {
      bounds,
      retentionDisabled: isRetentionDisabled(),
    };
  },
});

/**
 * Validate retention policy values against effective bounds, then
 * delegate the write to the internal mutation that owns the cooldown,
 * audit, and policy-row persistence logic.
 *
 * Replaces the bounds-validation branch inside `upsertPolicy` mutation
 * for `policyType === 'retention_policy'`. Other policy types still
 * use `upsertPolicy` directly.
 */
export const upsertRetentionPolicyAction = action({
  args: {
    organizationId: v.string(),
    config: v.any(),
  },
  returns: v.id('governancePolicies'),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'unauthenticated',
        message: 'Sign in required.',
      });
    }
    const member = await ctx.runQuery(
      internal.governance.internal_queries.verifyOrgAdmin,
      {
        organizationId: args.organizationId,
        userId: String(authUser._id),
        email: authUser.email ?? '',
        name: authUser.name,
      },
    );
    if (!member) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only admins can modify governance policies.',
      });
    }

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const orgConfig = await loadOrgRetentionConfig(ctx, orgSlug);
    if (!orgConfig) {
      throw new ConvexError({
        code: 'RETENTION_CONFIG_MISSING',
        message:
          'Retention config not yet installed. Copy examples/retention/default.json to $TALE_CONFIG_DIR/retention/default.json.',
      });
    }
    const boundsByCategory = buildBoundsByCategory(orgConfig);

    // Same field → category mapping the mutation used to do inline.
    // Keeping the list local (not exporting from retention_floors) so
    // the action — which is the only public bounds-validation entry —
    // owns the policy/category coupling.
    const cfg = args.config;
    const checks: Array<[RetentionCategory, unknown]> = [
      ['documents', cfg?.retentionDays],
      ['userTempHours', cfg?.userTempRetentionHours],
      ['agentTempHours', cfg?.agentTempRetentionHours],
      ['chatHistory', cfg?.chatHistoryRetentionDays],
      ['auditLog', cfg?.auditLogRetentionDays],
      ['workflowLog', cfg?.workflowLogRetentionDays],
      ['usageLedger', cfg?.usageLedgerRetentionDays],
      ['loginAttempt', cfg?.loginAttemptRetentionDays],
      ['chatFilterEvents', cfg?.chatFilterEventsRetentionDays],
      ['promptTemplates', cfg?.promptTemplatesRetentionDays],
      ['messageFeedback', cfg?.messageFeedbackRetentionDays],
      ['memoryAudit', cfg?.memoryAuditRetentionDays],
      ['customers', cfg?.customersRetentionDays],
      ['vendors', cfg?.vendorsRetentionDays],
      ['externalConversations', cfg?.externalConversationsRetentionDays],
      ['messageMetadata', cfg?.messageMetadataRetentionDays],
    ];
    for (const [cat, val] of checks) {
      if (typeof val !== 'number') continue;
      try {
        assertWithinBounds(boundsByCategory[cat], val);
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

    const policyId: import('../_generated/dataModel').Id<'governancePolicies'> =
      await ctx.runMutation(
        internal.governance.mutations.upsertRetentionPolicyInternal,
        {
          organizationId: args.organizationId,
          config: args.config,
          actorId: String(authUser._id),
          actorEmail: authUser.email,
          actorName: authUser.name,
        },
      );
    return policyId;
  },
});
