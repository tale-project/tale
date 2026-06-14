import { ConvexError, v } from 'convex/values';

import { retentionPolicyConfigSchema } from '../../lib/shared/schemas/governance';
import { isRecord } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { action, internalMutation } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

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
    ['documentsRetentionDays', 'documents'],
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

/**
 * DB-side finalize for `cancelPendingRetentionChange`. The V8 action reverts
 * the on-disk `retention-policy.json` to the snapshot's `oldConfig` (and
 * re-syncs the cache) first, then calls this to delete the pending row and
 * emit the audit entry. Auth is enforced by the action.
 */
export const finalizeCancelPendingRetention = internalMutation({
  args: {
    organizationId: v.string(),
    pendingId: v.id('retentionPolicyPendingChanges'),
    actorId: v.string(),
    actorEmail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const pending = await ctx.db.get(args.pendingId);
    if (!pending || pending.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Pending change does not exist.',
      });
    }

    await ctx.db.delete(args.pendingId);

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      actorEmail: args.actorEmail,
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

/**
 * Internal mutation invoked by `governance/retention_actions.
 * upsertRetentionPolicyAction`. Owns: Zod schema validation of the
 * retention config, 7-day cooldown insertion when values shrink,
 * policy-row persistence, and audit emission.
 *
 * Does NOT validate per-category bounds — the V8 action wrapper does
 * that against the file-loaded effective bounds before calling here.
 *
 * The action passes `actorId` / `actorEmail` / `actorName` through so
 * audit emission attributes the change to the human caller (we lose
 * `authComponent` access in this internal layer).
 */
export const recordRetentionPolicyChange = internalMutation({
  args: {
    organizationId: v.string(),
    /** Previous effective config, captured from `governanceCache` by the
     *  action BEFORE it overwrote the file. Drives shortening detection. */
    oldConfig: v.optional(v.any()),
    config: v.any(),
    actorId: v.string(),
    actorEmail: v.optional(v.string()),
    actorName: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const parsed = retentionPolicyConfigSchema.safeParse(args.config);
    if (!parsed.success) {
      throw new Error(
        `Invalid retention policy configuration: ${parsed.error.message}`,
      );
    }

    const hadPrevious = args.oldConfig !== undefined && args.oldConfig !== null;

    // 7-day cooldown on retention shortening (Phase 3). The file already holds
    // the NEW config; the cooldown row makes the cleanup runner keep using
    // `oldConfig` (via `getPendingRetentionChange`) until `appliesAt`.
    if (hadPrevious && isRecord(args.oldConfig)) {
      const summary = detectRetentionShortening(args.oldConfig, args.config);
      if (summary) {
        const cooldownMs = 7 * 24 * 60 * 60 * 1000;
        await ctx.db.insert('retentionPolicyPendingChanges', {
          organizationId: args.organizationId,
          appliesAt: Date.now() + cooldownMs,
          oldConfig: args.oldConfig,
          newConfig: args.config,
          requestedBy: args.actorId,
          requestedAt: Date.now(),
          summary,
        });
        await createAuditLog(ctx, {
          organizationId: args.organizationId,
          actorId: args.actorId,
          actorEmail: args.actorEmail,
          actorType: 'user',
          action: 'policy.retention_shortening_pending',
          category: 'security',
          resourceType: 'governance_policy',
          resourceId: 'retention_policy',
          resourceName: 'retention_policy',
          newState: { summary, appliesAt: Date.now() + cooldownMs },
          status: 'success',
        });
      }
    }

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      actorEmail: args.actorEmail,
      actorType: 'user',
      action: hadPrevious ? 'policy.updated' : 'policy.created',
      category: 'security',
      resourceType: 'governance_policy',
      resourceId: 'retention_policy',
      resourceName: 'Policy: retention_policy',
      newState: { policyType: 'retention_policy', config: args.config },
      previousState: hadPrevious
        ? { policyType: 'retention_policy', config: args.oldConfig }
        : undefined,
      status: 'success',
    });

    // First-enable seed: when no `retentionAppliedBounds` row exists for
    // this org yet, the admin's first save IS their consent to the
    // current operator bounds. Schedule the seed action (idempotent —
    // a no-op when a row already exists) so cleanup has something to
    // read from on its next run.
    const existingApplied = await ctx.db
      .query('retentionAppliedBounds')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    if (!existingApplied) {
      await ctx.scheduler.runAfter(
        0,
        internal.governance.retention_bounds_proposal.seedInitialBoundsInternal,
        {
          organizationId: args.organizationId,
          actorId: args.actorId,
          actorEmail: args.actorEmail,
          actorType: 'user',
        },
      );
    }

    return null;
  },
});

/**
 * Master switch for the task-ops automation pack (admin/owner only). Gates
 * BOTH halves: writes the `task_automation` policy (the run-agent action
 * refuses when disabled) and flips `isActive` on the pack's trigger rows so
 * the scheduler/event fan-out stop at the source. The kill-switch ops
 * commands (`workflows/ops/disable_task_ops_pack`) are the internal twins.
 */
export const setTaskAutomationEnabled = action({
  args: {
    organizationId: v.string(),
    enabled: v.boolean(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
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
      throw new Error('Only admins can toggle task automation');
    }

    // The twins write the `task_automation` policy file, flip the pack's
    // trigger rows, and emit the audit entry (attributed to the caller).
    if (args.enabled) {
      await ctx.runAction(
        internal.workflows.ops.disable_task_ops_pack.enableTaskOpsPack,
        {
          organizationId: args.organizationId,
          actorId: authUser.userId,
          actorEmail: authUser.email ?? undefined,
        },
      );
    } else {
      await ctx.runAction(
        internal.workflows.ops.disable_task_ops_pack.disableTaskOpsPack,
        {
          organizationId: args.organizationId,
          reason: args.reason ?? `disabled by ${authUser.userId}`,
          actorId: authUser.userId,
          actorEmail: authUser.email ?? undefined,
        },
      );
    }
    return null;
  },
});
