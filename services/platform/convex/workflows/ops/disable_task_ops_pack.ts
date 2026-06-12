/**
 * Task-ops kill switch + re-enable (operator runbook commands).
 *
 * `disableTaskOpsPack` makes "off" really off in two moves:
 *   1. writes the `task_automation` governance policy `{enabled: false}` —
 *      the run-agent action refuses at its first statement, so even already
 *      in-flight workflow executions cannot start new agent runs;
 *   2. flips `isActive: false` on every trigger row of `tasks/`-prefixed
 *      workflows, so the minutely scanner and event fan-out stop starting
 *      executions at the source.
 *
 * Time-to-quiet ≈ one scanner tick (< 2 min). Usage:
 *   bunx convex run workflows/ops/disable_task_ops_pack:disableTaskOpsPack \
 *     '{ "organizationId": "<org>", "reason": "incident-123" }'
 *   bunx convex run workflows/ops/disable_task_ops_pack:enableTaskOpsPack \
 *     '{ "organizationId": "<org>" }'
 */

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalMutation, type MutationCtx } from '../../_generated/server';
import { createAuditLog } from '../../audit_logs/helpers';

export const TASK_OPS_PACK_PREFIX = 'tasks/';

export async function listPackSlugs(
  ctx: MutationCtx,
  organizationId: string,
): Promise<string[]> {
  const slugs: string[] = [];
  for await (const row of ctx.db
    .query('wfInstallations')
    .withIndex('by_org', (q) => q.eq('organizationId', organizationId))) {
    if (row.workflowSlug.startsWith(TASK_OPS_PACK_PREFIX)) {
      slugs.push(row.workflowSlug);
    }
  }
  return slugs;
}

/** Upsert the `task_automation` policy row (shared by both directions). */
async function writeTaskAutomationPolicy(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    enabled: boolean;
    pausedBy?: string;
    reason?: string;
  },
): Promise<void> {
  const existing = await ctx.db
    .query('governancePolicies')
    .withIndex('by_org_policyType', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('policyType', 'task_automation'),
    )
    .first();
  const config = {
    enabled: args.enabled,
    ...(args.enabled
      ? {}
      : {
          pausedBy: args.pausedBy ?? 'ops',
          pausedAt: Date.now(),
          ...(args.reason ? { reason: args.reason } : {}),
        }),
  };
  if (existing) {
    await ctx.db.patch(existing._id, {
      config,
      updatedAt: Date.now(),
      updatedBy: args.pausedBy ?? 'system',
    });
  } else {
    await ctx.db.insert('governancePolicies', {
      organizationId: args.organizationId,
      policyType: 'task_automation',
      config,
      enabled: true,
      updatedAt: Date.now(),
      updatedBy: args.pausedBy ?? 'system',
    });
  }
}

export const disableTaskOpsPack = internalMutation({
  args: {
    organizationId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.object({ triggersDeactivated: v.number() }),
  handler: async (ctx, args): Promise<{ triggersDeactivated: number }> => {
    await writeTaskAutomationPolicy(ctx, {
      organizationId: args.organizationId,
      enabled: false,
      reason: args.reason ?? 'kill-switch',
    });
    const slugs = await listPackSlugs(ctx, args.organizationId);
    const counts = await ctx.runMutation(
      internal.workflows.provision_defaults_mutations.setTriggersActiveForSlugs,
      {
        organizationId: args.organizationId,
        workflowSlugs: slugs,
        isActive: false,
      },
    );
    const triggersDeactivated = counts.events + counts.schedules;
    console.error('[TaskOpsKillSwitch] disabled', {
      organizationId: args.organizationId,
      reason: args.reason,
      triggersDeactivated,
    });
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: 'system',
      actorType: 'system',
      action: 'governance.task_ops_kill_switch',
      category: 'admin',
      resourceType: 'governance_policy',
      resourceId: 'task_automation',
      metadata: { reason: args.reason ?? 'kill-switch', triggersDeactivated },
      status: 'success',
    });
    return { triggersDeactivated };
  },
});

export const enableTaskOpsPack = internalMutation({
  args: { organizationId: v.string() },
  returns: v.object({ triggersActivated: v.number() }),
  handler: async (ctx, args): Promise<{ triggersActivated: number }> => {
    await writeTaskAutomationPolicy(ctx, {
      organizationId: args.organizationId,
      enabled: true,
    });
    const slugs = await listPackSlugs(ctx, args.organizationId);
    const counts = await ctx.runMutation(
      internal.workflows.provision_defaults_mutations.setTriggersActiveForSlugs,
      {
        organizationId: args.organizationId,
        workflowSlugs: slugs,
        isActive: true,
      },
    );
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: 'system',
      actorType: 'system',
      action: 'governance.task_automation_toggled',
      category: 'admin',
      resourceType: 'governance_policy',
      resourceId: 'task_automation',
      metadata: { enabled: true },
      status: 'success',
    });
    return { triggersActivated: counts.events + counts.schedules };
  },
});
