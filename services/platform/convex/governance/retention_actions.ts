/**
 * Public V8 actions for retention bounds. Replace the deleted
 * `getEffectiveRetentionBounds` query and the retention branch of
 * `upsertPolicy` mutation. V8 runtime (no `'use node'`) — file IO is
 * delegated to `internal.lib.config_store.actions` via `ctx.runAction`.
 *
 * Why actions and not a query:
 *   - Bounds live in `$TALE_CONFIG_DIR/<orgSlug>/governance/retention.json` under
 *     the org-first layout. V8 queries/mutations cannot read fs and
 *     cannot await a Node action inline. Only V8 actions can
 *     `ctx.runAction(internal nodeAction)`.
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
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
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
 * Load the per-org retention config — the org's OWN file only, no cross-org
 * fallback (every org is seeded from the built-in catalog at create). Returns
 * `null` when absent; callers throw a config-missing error then.
 */
async function loadOrgRetentionConfig(
  ctx: ActionCtx,
  orgSlug: string,
): Promise<RetentionDefaultsConfig | null> {
  // readConfigArea validates retention.json via parseRetentionJson before
  // returning; the generic `unknown` result is therefore a RetentionDefaultsConfig.
  const own = await ctx.runAction(
    internal.lib.config_store.actions.readConfigArea,
    { area: 'retention', orgSlug },
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated by readConfigArea
  return own ? (own as RetentionDefaultsConfig) : null;
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'unauthenticated',
        message: 'Sign in required.',
      });
    }
    await ctx.runQuery(internal.governance.internal_queries.verifyOrgMember, {
      organizationId: args.organizationId,
      userId: authUser.userId,
      email: authUser.email ?? '',
      name: authUser.name,
    });

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const orgConfig = await loadOrgRetentionConfig(ctx, orgSlug);
    if (!orgConfig) {
      // A not-yet-installed retention config is an expected empty state on
      // normal page loads (e.g. a fresh org), not an error. Return empty
      // bounds so the editor falls back to schema-level defaults instead of
      // logging a RETENTION_CONFIG_MISSING ConvexError on every load.
      return {
        bounds: [],
        retentionDisabled: isRetentionDisabled(),
      };
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
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
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
        userId: authUser.userId,
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
        message: `Retention config not yet installed. Copy configs/platform/custom/governance/retention.yml to $TALE_CONFIG_DIR/${orgSlug}/governance/retention.yml.`,
      });
    }
    const boundsByCategory = buildBoundsByCategory(orgConfig);

    // Same field → category mapping the mutation used to do inline.
    // Keeping the list local (not exporting from retention_floors) so
    // the action — which is the only public bounds-validation entry —
    // owns the policy/category coupling.
    const cfg = args.config;
    const checks: Array<[RetentionCategory, unknown]> = [
      ['documents', cfg?.documentsRetentionDays],
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
      ['contacts', cfg?.contactsRetentionDays],
      ['externalConversations', cfg?.externalConversationsRetentionDays],
      ['notifications', cfg?.notificationsRetentionDays],
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

    // Capture the previous effective config from the cache BEFORE the file is
    // overwritten, so the cooldown can detect shortening against it.
    const oldConfig: unknown = await ctx.runQuery(
      internal.governance.internal_queries.getPolicyConfigInternal,
      { organizationId: args.organizationId, policyType: 'retention_policy' },
    );

    // Files are the source of truth: write the validated config to
    // `<org>/governance/retention-policy.json` and re-sync the cache.
    await ctx.runAction(
      internal.governance.file_actions.persistGovernancePolicyFile,
      {
        organizationId: args.organizationId,
        policyType: 'retention_policy',
        config: args.config,
      },
    );

    // Cooldown + audit + first-enable bounds seed (DB-side bookkeeping).
    await ctx.runMutation(
      internal.governance.mutations.recordRetentionPolicyChange,
      {
        organizationId: args.organizationId,
        oldConfig,
        config: args.config,
        actorId: authUser.userId,
        actorEmail: authUser.email,
        actorName: authUser.name,
      },
    );
    return null;
  },
});

/**
 * Cancel a pending retention-shortening before its cooldown elapses
 * (admin-only). Reverts the on-disk `retention-policy.json` to the snapshot's
 * `oldConfig`, re-syncs the cache, then deletes the pending row + audits.
 * File-based replacement for the old `mutations.cancelPendingRetentionChange`
 * (which patched the `governancePolicies` row).
 */
export const cancelPendingRetentionChange = action({
  args: {
    organizationId: v.string(),
    pendingId: v.id('retentionPolicyPendingChanges'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
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
        userId: authUser.userId,
        email: authUser.email ?? '',
        name: authUser.name,
      },
    );
    if (!member) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only admins can cancel pending retention changes.',
      });
    }

    const pending = await ctx.runQuery(
      internal.governance.internal_queries.getRetentionPendingById,
      { organizationId: args.organizationId, pendingId: args.pendingId },
    );
    if (!pending) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Pending change does not exist.',
      });
    }

    // Revert the file to the pre-shortening config + re-sync the cache.
    await ctx.runAction(
      internal.governance.file_actions.persistGovernancePolicyFile,
      {
        organizationId: args.organizationId,
        policyType: 'retention_policy',
        config: pending.oldConfig,
      },
    );

    await ctx.runMutation(
      internal.governance.mutations.finalizeCancelPendingRetention,
      {
        organizationId: args.organizationId,
        pendingId: args.pendingId,
        actorId: authUser.userId,
        actorEmail: authUser.email,
      },
    );
    return null;
  },
});
