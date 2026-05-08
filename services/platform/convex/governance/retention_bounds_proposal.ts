/**
 * Public V8 actions for the operator-side retention bounds proposal
 * gate. The JSON file under `$TALE_CONFIG_DIR/retention/{orgSlug}.json`
 * (and `TALE_RETENTION_*` env tightening) are no longer directives —
 * they're proposals. Cleanup uses `retentionAppliedBounds.appliedBounds`,
 * which only changes when an admin clicks Apply here.
 *
 * Three actions:
 *   - `getPendingBoundsProposal`  — banner data: diff + impact preview
 *   - `applyBoundsProposal`        — admin accepts; cleanup picks up
 *                                    new bounds on next run
 *   - `rejectBoundsProposal`       — admin refuses; banner stays hidden
 *                                    until file/env hash diverges from
 *                                    the rejected hash
 *
 * Auth:
 *   - get: any org member (bounds aren't org-secret)
 *   - apply / reject: admin only
 *
 * Optimistic concurrency: apply takes a `proposedHash` arg and re-hashes
 * the live effective bounds; mismatch ⇒ `STALE_PROPOSAL` so the banner
 * refetches instead of writing yesterday's proposal over today's edit.
 */

import { ConvexError, v } from 'convex/values';

import {
  RETENTION_CATEGORIES,
  type AppliedBoundsByCategory,
  type RetentionCategory,
  type RetentionDefaultsConfig,
  hashAppliedBounds,
} from '../../lib/shared/schemas/retention';
import { isRecord } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { action, internalAction } from '../_generated/server';
import { authComponent } from '../auth';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import {
  RetentionConfigMissingError,
  applyEnvTighteningAll,
} from './retention_floors';

/**
 * Load the per-org retention config, falling back to the `default`
 * org's file. Identical to the helper in `retention_actions.ts`; kept
 * local so this file doesn't depend on the sibling action layer.
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
 * Compute the effective bounds (file × env) for the org as the minimal
 * `{category: {min, max}}` shape that goes into `retentionAppliedBounds`
 * + the hash. The full `EffectiveBoundDef` (with env-binding detail and
 * display metadata) is for the banner UI, not the snapshot.
 */
async function computeEffectiveAppliedBounds(
  ctx: ActionCtx,
  orgSlug: string,
): Promise<AppliedBoundsByCategory> {
  const orgConfig = await loadOrgRetentionConfig(ctx, orgSlug);
  if (!orgConfig) {
    throw new ConvexError({
      code: 'RETENTION_CONFIG_MISSING',
      message:
        'Retention config not yet installed. Copy examples/retention/default.json to $TALE_CONFIG_DIR/retention/default.json then reload.',
    });
  }
  const all = applyEnvTighteningAll(orgConfig);
  const out: AppliedBoundsByCategory = {};
  for (const def of all) {
    out[def.category] = { min: def.min, max: def.max };
  }
  return out;
}

const POLICY_FIELD_BY_CATEGORY: Record<RetentionCategory, string> = {
  documents: 'documentsRetentionDays',
  userTempHours: 'userTempRetentionHours',
  agentTempHours: 'agentTempRetentionHours',
  chatHistory: 'chatHistoryRetentionDays',
  auditLog: 'auditLogRetentionDays',
  workflowLog: 'workflowLogRetentionDays',
  usageLedger: 'usageLedgerRetentionDays',
  loginAttempt: 'loginAttemptRetentionDays',
  chatFilterEvents: 'chatFilterEventsRetentionDays',
  promptTemplates: 'promptTemplatesRetentionDays',
  messageFeedback: 'messageFeedbackRetentionDays',
  memoryAudit: 'memoryAuditRetentionDays',
  customers: 'customersRetentionDays',
  vendors: 'vendorsRetentionDays',
  externalConversations: 'externalConversationsRetentionDays',
  messageMetadata: 'messageMetadataRetentionDays',
};

interface BoundDiffEntry {
  category: string;
  field: 'min' | 'max';
  from: number;
  to: number;
  direction: 'tighten' | 'loosen';
}

interface ImpactEntry {
  category: string;
  field: string;
  current: number;
  willClampTo: number;
}

/**
 * Per-category diff between two `AppliedBoundsByCategory` snapshots.
 * `tighten` = floor raised OR ceiling lowered; `loosen` = the reverse.
 * Identical values are omitted.
 */
function diffBounds(
  from: AppliedBoundsByCategory | null,
  to: AppliedBoundsByCategory,
): BoundDiffEntry[] {
  const out: BoundDiffEntry[] = [];
  for (const cat of RETENTION_CATEGORIES) {
    const a = from?.[cat];
    const b = to[cat];
    if (!b) continue;
    const fromMin = a?.min ?? b.min;
    const fromMax = a?.max ?? b.max;
    if (b.min !== fromMin) {
      out.push({
        category: cat,
        field: 'min',
        from: fromMin,
        to: b.min,
        direction: b.min > fromMin ? 'tighten' : 'loosen',
      });
    }
    if (b.max !== fromMax) {
      out.push({
        category: cat,
        field: 'max',
        from: fromMax,
        to: b.max,
        direction: b.max < fromMax ? 'tighten' : 'loosen',
      });
    }
  }
  return out;
}

/**
 * For each diffed category, project what would happen to the org's
 * stored retention value if the proposal is applied. Reads
 * `governancePolicies.retention_policy.config` and clamps each
 * `<category>RetentionDays/Hours` field to the proposed `[min, max]`.
 */
function buildImpactPreview(
  proposed: AppliedBoundsByCategory,
  storedConfig: unknown,
): ImpactEntry[] {
  if (!isRecord(storedConfig)) return [];
  const out: ImpactEntry[] = [];
  for (const cat of RETENTION_CATEGORIES) {
    const bound = proposed[cat];
    if (!bound) continue;
    const field = POLICY_FIELD_BY_CATEGORY[cat];
    const current = storedConfig[field];
    if (typeof current !== 'number' || !Number.isFinite(current)) continue;
    const clamped = Math.min(Math.max(current, bound.min), bound.max);
    if (clamped !== current) {
      out.push({ category: cat, field, current, willClampTo: clamped });
    }
  }
  return out;
}

const boundsRecordValidator = v.record(
  v.string(),
  v.object({ min: v.number(), max: v.number() }),
);

const diffEntryValidator = v.object({
  category: v.string(),
  field: v.union(v.literal('min'), v.literal('max')),
  from: v.number(),
  to: v.number(),
  direction: v.union(v.literal('tighten'), v.literal('loosen')),
});

const impactEntryValidator = v.object({
  category: v.string(),
  field: v.string(),
  current: v.number(),
  willClampTo: v.number(),
});

interface PendingBoundsProposal {
  firstApply: boolean;
  proposedBounds: AppliedBoundsByCategory;
  proposedHash: string;
  appliedBounds: AppliedBoundsByCategory | null;
  diff: BoundDiffEntry[];
  impactPreview: ImpactEntry[];
}

/**
 * Read-only banner feed. Returns `null` when the editor can stay
 * silent — either the operator has not changed anything (current hash
 * matches applied), or the admin already rejected the current hash
 * (and operator hasn't edited since).
 *
 * On first-time orgs (no applied row yet), returns `firstApply: true`
 * so the editor surfaces an "initial bounds" prompt rather than a
 * "changes since last apply" diff.
 */
export const getPendingBoundsProposal = action({
  args: { organizationId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      firstApply: v.boolean(),
      proposedBounds: boundsRecordValidator,
      proposedHash: v.string(),
      appliedBounds: v.union(v.null(), boundsRecordValidator),
      diff: v.array(diffEntryValidator),
      impactPreview: v.array(impactEntryValidator),
    }),
  ),
  handler: async (ctx, args): Promise<PendingBoundsProposal | null> => {
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
    let proposedBounds: AppliedBoundsByCategory;
    try {
      proposedBounds = await computeEffectiveAppliedBounds(ctx, orgSlug);
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
    const proposedHash = await hashAppliedBounds(proposedBounds);

    const applied: {
      appliedBounds?: unknown;
      appliedBoundsHash?: string;
      rejectedBoundsHash?: string;
    } | null = await ctx.runQuery(
      internal.governance.internal_queries.getAppliedBounds,
      { organizationId: args.organizationId },
    );

    if (applied && applied.appliedBoundsHash === proposedHash) {
      return null;
    }
    if (applied && applied.rejectedBoundsHash === proposedHash) {
      return null;
    }

    const appliedBounds = applied?.appliedBounds
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- v.any() round-trip
        (applied.appliedBounds as AppliedBoundsByCategory)
      : null;

    // For impact preview we want to know how the admin's stored values
    // would clamp under the new bounds. Read the retention policy row.
    const policyRow = await ctx.runQuery(
      internal.governance.internal_queries.listRetentionPolicies,
      {},
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- internal query returns v.any()
    const policies = policyRow as Array<{
      organizationId: string;
      config: unknown;
    }>;
    const orgPolicy = policies.find(
      (p) => p.organizationId === args.organizationId,
    );

    return {
      firstApply: !applied,
      proposedBounds,
      proposedHash,
      appliedBounds,
      diff: diffBounds(appliedBounds, proposedBounds),
      impactPreview: buildImpactPreview(proposedBounds, orgPolicy?.config),
    };
  },
});

/**
 * Admin accepts the current proposal. Re-reads file+env, re-computes
 * hash, optimistic-concurrency check against the `proposedHash` arg.
 * On match, copies the bounds into `retentionAppliedBounds` and clears
 * any prior rejection. Audit row written inside the internal mutation.
 */
export const applyBoundsProposal = action({
  args: {
    organizationId: v.string(),
    proposedHash: v.string(),
  },
  returns: v.id('retentionAppliedBounds'),
  handler: async (ctx, args): Promise<Id<'retentionAppliedBounds'>> => {
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
        message: 'Only admins can apply bound proposals.',
      });
    }

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const proposedBounds = await computeEffectiveAppliedBounds(ctx, orgSlug);
    const liveHash = await hashAppliedBounds(proposedBounds);
    if (liveHash !== args.proposedHash) {
      throw new ConvexError({
        code: 'STALE_PROPOSAL',
        message:
          'Operator config changed while you were reviewing. Refresh the editor to see the new proposal.',
        liveHash,
      });
    }

    return ctx.runMutation(
      internal.governance.internal_mutations_retention.upsertAppliedBounds,
      {
        organizationId: args.organizationId,
        appliedBounds: proposedBounds,
        appliedBoundsHash: liveHash,
        actorId: String(authUser._id),
        actorEmail: authUser.email ?? undefined,
        actorType: 'user',
        auditAction: 'policy.retention_bounds_proposal_applied',
      },
    );
  },
});

/**
 * Admin refuses the current proposal. Records the proposed hash in
 * `rejectedBoundsHash`; banner reappears when operator's effective
 * hash diverges from BOTH applied and rejected.
 *
 * Refuses gracefully when there's no applied row yet (first-time orgs
 * cannot reject — they must Apply at least once).
 */
export const rejectBoundsProposal = action({
  args: {
    organizationId: v.string(),
    proposedHash: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
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
        message: 'Only admins can reject bound proposals.',
      });
    }

    const applied = await ctx.runQuery(
      internal.governance.internal_queries.getAppliedBounds,
      { organizationId: args.organizationId },
    );
    if (!applied) {
      throw new ConvexError({
        code: 'no_applied_bounds',
        message:
          'No applied bounds yet — you must Apply once before you can Reject. Save retention policy in the editor or have the operator run the seed migration.',
      });
    }

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const proposedBounds = await computeEffectiveAppliedBounds(ctx, orgSlug);
    const liveHash = await hashAppliedBounds(proposedBounds);
    if (liveHash !== args.proposedHash) {
      throw new ConvexError({
        code: 'STALE_PROPOSAL',
        message:
          'Operator config changed while you were reviewing. Refresh the editor to see the new proposal.',
        liveHash,
      });
    }

    await ctx.runMutation(
      internal.governance.internal_mutations_retention.setRejectedBounds,
      {
        organizationId: args.organizationId,
        rejectedBoundsHash: liveHash,
        proposedBounds,
        actorId: String(authUser._id),
        actorEmail: authUser.email ?? undefined,
      },
    );
    return null;
  },
});

/**
 * First-enable / migration seeder. Computes effective bounds for an
 * org and writes them to `retentionAppliedBounds` IFF the row is
 * absent. Idempotent — re-firing this for an org that already has a
 * row is a silent no-op (so concurrent admin saves and migration
 * re-runs are both safe).
 *
 * Scheduled with 0 delay from `upsertRetentionPolicyInternal` after
 * the policy row is committed, and called directly by the migration
 * script.
 *
 * Audit: `policy.retention_bounds_initial_applied`. The `actorId`
 * passed in distinguishes user-initiated first-enable
 * (`actorId = userId`) from migration backfill
 * (`actorId = 'system_migration'`).
 */
export const seedInitialBoundsInternal = internalAction({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    actorEmail: v.optional(v.string()),
    actorType: v.union(v.literal('user'), v.literal('system')),
  },
  returns: v.union(v.null(), v.id('retentionAppliedBounds')),
  handler: async (ctx, args): Promise<Id<'retentionAppliedBounds'> | null> => {
    const existing = await ctx.runQuery(
      internal.governance.internal_queries.getAppliedBounds,
      { organizationId: args.organizationId },
    );
    if (existing) {
      // Idempotent: org already has applied bounds. Don't overwrite —
      // any change must go through the explicit Apply flow.
      return null;
    }
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    let proposedBounds: AppliedBoundsByCategory;
    try {
      proposedBounds = await computeEffectiveAppliedBounds(ctx, orgSlug);
    } catch (err) {
      if (err instanceof ConvexError) {
        // Config-missing — operator hasn't installed the file. Log
        // loudly so the seed retry path is obvious and bail (cleanup
        // already skips orgs without applied rows).
        console.warn(
          `[seedInitialBoundsInternal] org ${args.organizationId}: ${err.message}`,
        );
        return null;
      }
      throw err;
    }
    const appliedBoundsHash = await hashAppliedBounds(proposedBounds);
    return ctx.runMutation(
      internal.governance.internal_mutations_retention.upsertAppliedBounds,
      {
        organizationId: args.organizationId,
        appliedBounds: proposedBounds,
        appliedBoundsHash,
        actorId: args.actorId,
        actorEmail: args.actorEmail,
        actorType: args.actorType,
        auditAction: 'policy.retention_bounds_initial_applied',
      },
    );
  },
});
