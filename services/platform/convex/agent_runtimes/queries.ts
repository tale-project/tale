/**
 * Read surface for the runtimes settings page and the task-detail external
 * run panel. Status is DERIVED from heartbeat age at read time (active /
 * degraded / offline) — there is no status field to drift.
 */

import { v } from 'convex/values';

import { query, type QueryCtx } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { RUNTIME_DEGRADED_AFTER_MS, RUNTIME_OFFLINE_AFTER_MS } from './schema';

async function requireMember(
  ctx: QueryCtx,
  organizationId: string,
): Promise<void> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) throw new Error('Unauthenticated');
  await getOrganizationMember(ctx, organizationId, authUser);
}

function derivedStatus(
  lastHeartbeatAt: number,
  now: number,
): 'active' | 'degraded' | 'offline' {
  const age = now - lastHeartbeatAt;
  if (age <= RUNTIME_DEGRADED_AFTER_MS) return 'active';
  if (age <= RUNTIME_OFFLINE_AFTER_MS) return 'degraded';
  return 'offline';
}

export const listRuntimes = query({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({
      daemonId: v.string(),
      adapterType: v.string(),
      name: v.optional(v.string()),
      version: v.optional(v.string()),
      capabilities: v.optional(
        v.object({
          jsonOutput: v.boolean(),
          sessionResume: v.boolean(),
          costReporting: v.boolean(),
          mcp: v.boolean(),
        }),
      ),
      workspaceKeys: v.optional(v.array(v.string())),
      status: v.union(
        v.literal('active'),
        v.literal('degraded'),
        v.literal('offline'),
      ),
      lastHeartbeatAt: v.number(),
      registeredAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const now = Date.now();
    const rows = [];
    for await (const runtime of ctx.db
      .query('agentRuntimes')
      .withIndex('by_org', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      rows.push({
        daemonId: runtime.daemonId,
        adapterType: runtime.adapterType,
        name: runtime.name,
        version: runtime.version,
        capabilities: runtime.capabilities,
        workspaceKeys: runtime.workspaceKeys,
        status: derivedStatus(runtime.lastHeartbeatAt, now),
        lastHeartbeatAt: runtime.lastHeartbeatAt,
        registeredAt: runtime.registeredAt,
      });
      if (rows.length >= 100) break;
    }
    return rows.sort(
      (a, b) =>
        a.daemonId.localeCompare(b.daemonId) ||
        a.adapterType.localeCompare(b.adapterType),
    );
  },
});

/** External runs for one task (the task-detail runtime panel). Bounded. */
export const listExternalRunsForTask = query({
  args: { taskId: v.id('tasks') },
  returns: v.any(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return [];
    await requireMember(ctx, task.organizationId);

    const runs = [];
    for await (const run of ctx.db
      .query('externalRuns')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))) {
      runs.push({
        externalRunId: run._id,
        agentSlug: run.agentSlug,
        adapterType: run.adapterType,
        status: run.status,
        failReason: run.failReason,
        kind: run.kind,
        attempts: run.attempts,
        claimedByDaemonId: run.claimedByDaemonId,
        resultSummary: run.resultSummary,
        diffStat: run.diffStat,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
      });
      if (runs.length >= 20) break;
    }
    return runs.toReversed();
  },
});
