/**
 * Query-side access resolution for the workspace-tool bridge
 * (`node_only/sandbox/workspace_tools_bridge.ts` — an action, so the
 * membership read has to cross into a query). One check per dispatch: the
 * turn's user must still be an active member of the session's org AND their
 * role must grant `read` on the table the tool exposes — the same policy the
 * user-side `queryWithRLS` surfaces enforce, via the same primitives
 * (`lib/rls/helpers/agent_read_access.ts`).
 */

import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { internalQuery, type QueryCtx } from '../_generated/server';
import {
  NO_KNOWLEDGE_ACCESS,
  resolveKnowledgeAccessForUser,
  type ResolvedKnowledgeAccess,
} from '../documents/access';
import {
  resolveAgentReadAccess,
  type AgentReadAccess,
} from '../lib/rls/helpers/agent_read_access';
import { getProjectTeamIds } from '../projects/access';

export const resolveWorkspaceReadAccess = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    subject: v.union(
      v.literal('documents'),
      v.literal('contacts'),
      v.literal('products'),
      v.literal('websites'),
    ),
  },
  returns: v.union(
    v.object({ allowed: v.literal(true), role: v.string() }),
    v.object({
      allowed: v.literal(false),
      reason: v.union(v.literal('not_a_member'), v.literal('read_denied')),
    }),
  ),
  handler: async (ctx, args): Promise<AgentReadAccess> => {
    return await resolveAgentReadAccess(ctx, args);
  },
});

/** The project a session is bound to, when its owner is one that carries a
 * project: a project agent's standing sandbox (`ownerId` = the projectAgents
 * row id) or an automation run's sandbox (`ownerId` = `${runId}:…`, the run
 * stamped with the task/automation project). `null` for every other owner —
 * chat external turns, renders, legacy sessions. */
async function sessionProject(
  ctx: QueryCtx,
  organizationId: string,
  sessionId: string,
): Promise<Doc<'projects'> | null> {
  const session = await ctx.db
    .query('sandboxSessions')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .first();
  if (session === null || session.organizationId !== organizationId) {
    return null;
  }

  let projectId: Id<'projects'> | null = null;
  if (session.ownerType === 'project_agent') {
    const agentId = ctx.db.normalizeId('projectAgents', session.ownerId);
    const agent = agentId === null ? null : await ctx.db.get(agentId);
    if (agent !== null && agent.organizationId === organizationId) {
      projectId = agent.projectId;
    }
  } else if (session.ownerType === 'workflow_run') {
    // `workflowExecutionOwnerId(runId)` / step owners = `${runId}:<suffix>`.
    const runIdRaw = session.ownerId.split(':')[0] ?? '';
    const runId = ctx.db.normalizeId('automationRuns', runIdRaw);
    const run = runId === null ? null : await ctx.db.get(runId);
    if (run !== null && run.organizationId === organizationId) {
      projectId = run.projectId ?? null;
    }
  }
  if (projectId === null) return null;

  const project = await ctx.db.get(projectId);
  return project !== null && project.organizationId === organizationId
    ? project
    : null;
}

/**
 * The knowledge-retrieval visibility of one sandbox dispatch — derived
 * SERVER-SIDE from what the session token proves, never from the request:
 *
 * - a PROJECT-BOUND session (a project agent's sandbox, an automation run
 *   with a project) sees its project's documents, the libraries of the teams
 *   that project is shared with (`teamId` + `sharedWithTeamIds`), and the
 *   org hub;
 * - a user-keyed session (a chat external turn) sees exactly what that USER
 *   sees — the same rules as the chat assistant and the library listings
 *   (`resolveKnowledgeAccessForUser`);
 * - a session that is neither fails CLOSED.
 */
export const resolveWorkspaceKnowledgeScope = internalQuery({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    userId: v.optional(v.string()),
  },
  returns: v.object({
    teamIds: v.array(v.string()),
    projectIds: v.array(v.string()),
    includeHub: v.boolean(),
  }),
  handler: async (ctx, args): Promise<ResolvedKnowledgeAccess> => {
    const project = await sessionProject(
      ctx,
      args.organizationId,
      args.sessionId,
    );
    if (project !== null) {
      return {
        teamIds: getProjectTeamIds(project),
        projectIds: [project._id],
        includeHub: true,
      };
    }
    if (args.userId !== undefined) {
      return await resolveKnowledgeAccessForUser(ctx, {
        organizationId: args.organizationId,
        userId: args.userId,
      });
    }
    return { ...NO_KNOWLEDGE_ACCESS };
  },
});
