/**
 * Task-ops kill switch + re-enable (operator runbook commands).
 *
 * `disableTaskOpsPack` makes "off" really off in two moves:
 *   1. writes the `task_automation` governance policy `{enabled: false}` to its
 *      per-org JSON file (source of truth) + re-syncs the cache — the run-agent
 *      action refuses at its first statement, so even already in-flight workflow
 *      executions cannot start new agent runs;
 *   2. flips `isActive: false` on every trigger row of the task-ops pack
 *      automations ({@link TASK_OPS_PACK_SLUGS}), so the minutely scanner and
 *      event fan-out stop starting executions at the source.
 *
 * The policy write is filesystem I/O, so these are Convex actions (not
 * mutations); the trigger flip + audit run in `applyTaskOpsTriggers` (a
 * mutation) which the action invokes.
 *
 * Time-to-quiet ≈ one scanner tick (< 2 min). Usage:
 *   bunx convex run workflows/ops/disable_task_ops_pack:disableTaskOpsPack \
 *     '{ "organizationId": "<org>", "reason": "incident-123" }'
 *   bunx convex run workflows/ops/disable_task_ops_pack:enableTaskOpsPack \
 *     '{ "organizationId": "<org>" }'
 */

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from '../../_generated/server';
import { createAuditLog } from '../../audit_logs/helpers';

/**
 * The task-ops pack: the auto-installed `folder: "tasks"` / `"discussions"`
 * automations under `builtin-configs/automations/` (each carries its workflow
 * inline; workflowSlug === automationSlug). The kill switch targets exactly
 * these — adding a pack automation means adding its slug here.
 */
export const TASK_OPS_PACK_SLUGS: readonly string[] = [
  'run-assigned-task',
  'triage-unassigned-tasks',
  'react-to-task-mention',
  'review-completed-work',
  'sweep-stale-work',
  'start-queued-work',
  'archive-closed-tasks',
  'enforce-task-slas',
  'unblock-dependent-tasks',
  'roll-up-completed-subtasks',
  'remind-pending-reviewers',
  'react-to-discussion-mention',
];

/** The pack slugs actually installed in this org (trigger rows key on them). */
export async function listPackSlugs(
  ctx: MutationCtx,
  organizationId: string,
): Promise<string[]> {
  const pack = new Set(TASK_OPS_PACK_SLUGS);
  const slugs: string[] = [];
  for await (const row of ctx.db
    .query('wfInstallations')
    .withIndex('by_org', (q) => q.eq('organizationId', organizationId))) {
    if (pack.has(row.workflowSlug)) {
      slugs.push(row.workflowSlug);
    }
  }
  return slugs;
}

/** Build the `task_automation` policy config for a given direction. */
function taskAutomationConfig(args: {
  enabled: boolean;
  pausedBy?: string;
  reason?: string;
}): Record<string, unknown> {
  return {
    enabled: args.enabled,
    ...(args.enabled
      ? {}
      : {
          pausedBy: args.pausedBy ?? 'ops',
          pausedAt: Date.now(),
          ...(args.reason ? { reason: args.reason } : {}),
        }),
  };
}

/**
 * Flip the pack's trigger rows on/off and emit the audit entry. The DB-side
 * half of the kill switch; the policy-file write happens in the calling action.
 */
export const applyTaskOpsTriggers = internalMutation({
  args: {
    organizationId: v.string(),
    enabled: v.boolean(),
    reason: v.optional(v.string()),
    actorId: v.optional(v.string()),
    actorEmail: v.optional(v.string()),
  },
  returns: v.object({ triggersChanged: v.number() }),
  handler: async (ctx, args): Promise<{ triggersChanged: number }> => {
    const slugs = await listPackSlugs(ctx, args.organizationId);
    const counts = await ctx.runMutation(
      internal.workflows.provision_defaults_mutations.setTriggersActiveForSlugs,
      {
        organizationId: args.organizationId,
        workflowSlugs: slugs,
        isActive: args.enabled,
      },
    );
    const triggersChanged = counts.events + counts.schedules;
    if (!args.enabled) {
      console.error('[TaskOpsKillSwitch] disabled', {
        organizationId: args.organizationId,
        reason: args.reason,
        triggersChanged,
      });
    }
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: args.actorId ?? 'system',
      actorEmail: args.actorEmail,
      actorType: args.actorId ? 'user' : 'system',
      action: args.enabled
        ? 'governance.task_automation_toggled'
        : 'governance.task_ops_kill_switch',
      category: 'admin',
      resourceType: 'governance_policy',
      resourceId: 'task_automation',
      metadata: args.enabled
        ? { enabled: true }
        : {
            reason: args.reason ?? 'kill-switch',
            triggersDeactivated: triggersChanged,
          },
      newState: { enabled: args.enabled },
      status: 'success',
    });
    return { triggersChanged };
  },
});

export const disableTaskOpsPack = internalAction({
  args: {
    organizationId: v.string(),
    reason: v.optional(v.string()),
    actorId: v.optional(v.string()),
    actorEmail: v.optional(v.string()),
  },
  returns: v.object({ triggersDeactivated: v.number() }),
  handler: async (ctx, args): Promise<{ triggersDeactivated: number }> => {
    await ctx.runAction(
      internal.governance.file_actions.persistGovernancePolicyFile,
      {
        organizationId: args.organizationId,
        policyType: 'task_automation',
        config: taskAutomationConfig({
          enabled: false,
          pausedBy: args.actorId,
          reason: args.reason ?? 'kill-switch',
        }),
      },
    );
    const { triggersChanged } = await ctx.runMutation(
      internal.workflows.ops.disable_task_ops_pack.applyTaskOpsTriggers,
      {
        organizationId: args.organizationId,
        enabled: false,
        reason: args.reason,
        actorId: args.actorId,
        actorEmail: args.actorEmail,
      },
    );
    return { triggersDeactivated: triggersChanged };
  },
});

export const enableTaskOpsPack = internalAction({
  args: {
    organizationId: v.string(),
    actorId: v.optional(v.string()),
    actorEmail: v.optional(v.string()),
  },
  returns: v.object({ triggersActivated: v.number() }),
  handler: async (ctx, args): Promise<{ triggersActivated: number }> => {
    await ctx.runAction(
      internal.governance.file_actions.persistGovernancePolicyFile,
      {
        organizationId: args.organizationId,
        policyType: 'task_automation',
        config: taskAutomationConfig({ enabled: true }),
      },
    );
    const { triggersChanged } = await ctx.runMutation(
      internal.workflows.ops.disable_task_ops_pack.applyTaskOpsTriggers,
      {
        organizationId: args.organizationId,
        enabled: true,
        actorId: args.actorId,
        actorEmail: args.actorEmail,
      },
    );
    return { triggersActivated: triggersChanged };
  },
});
