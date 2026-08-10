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

/** What a session's OWNER proves about knowledge visibility: bound to one
 * project (a project agent's standing sandbox — `ownerId` = the projectAgents
 * row id — or an automation run stamped with a project), an org-level
 * automation run (`ownerType` `workflow_run` whose run carries no project),
 * or nothing at all — chat external turns, renders, legacy sessions, and any
 * row whose owner cannot be resolved in this org. */
type SessionBinding =
  | { kind: 'project'; project: Doc<'projects'> }
  | { kind: 'org_run' }
  | { kind: 'none' };

async function sessionBinding(
  ctx: QueryCtx,
  organizationId: string,
  sessionId: string,
): Promise<SessionBinding> {
  const session = await ctx.db
    .query('sandboxSessions')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .first();
  if (session === null || session.organizationId !== organizationId) {
    return { kind: 'none' };
  }

  let projectId: Id<'projects'> | null = null;
  let orgRun = false;
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
      // A run deployed without a project is an ORG-LEVEL surface; a run whose
      // project row is gone stays fail-closed below, never widened.
      orgRun = run.projectId === undefined;
    }
  }
  if (projectId !== null) {
    const project = await ctx.db.get(projectId);
    if (project !== null && project.organizationId === organizationId) {
      return { kind: 'project', project };
    }
    return { kind: 'none' };
  }
  return orgRun ? { kind: 'org_run' } : { kind: 'none' };
}

/**
 * The access of one knowledge-tool dispatch (`rag_search` / `rag_fetch`) —
 * derived SERVER-SIDE from what the session token proves, never from the
 * request:
 *
 * - a PROJECT-BOUND session (a project agent's sandbox — every task-agent
 *   turn — or an automation run with a project) reads its project's
 *   documents, the libraries of the teams that project is shared with
 *   (`teamId` + `sharedWithTeamIds`), and the org hub;
 * - an ORG-LEVEL automation run (no project on the run) reads the org hub
 *   only — exactly the documents every active member already sees;
 * - a user-keyed session (a chat external turn) reads what that USER reads —
 *   their role checked against the same matrix as the user-side RLS queries
 *   (`subject` names the table the ref resolves to), then their own
 *   team/project visibility (`resolveKnowledgeAccessForUser`);
 * - a session with neither binding nor user is REFUSED, with the reason.
 */
export const resolveKnowledgeToolAccess = internalQuery({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    userId: v.optional(v.string()),
    subject: v.union(v.literal('documents'), v.literal('websites')),
  },
  returns: v.union(
    v.object({
      allowed: v.literal(true),
      scope: v.object({
        teamIds: v.array(v.string()),
        projectIds: v.array(v.string()),
        includeHub: v.boolean(),
      }),
    }),
    v.object({
      allowed: v.literal(false),
      reason: v.union(
        v.literal('no_access_context'),
        v.literal('not_a_member'),
        v.literal('read_denied'),
      ),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    | { allowed: true; scope: ResolvedKnowledgeAccess }
    | {
        allowed: false;
        reason: 'no_access_context' | 'not_a_member' | 'read_denied';
      }
  > => {
    const binding = await sessionBinding(
      ctx,
      args.organizationId,
      args.sessionId,
    );
    if (binding.kind === 'project') {
      return {
        allowed: true,
        scope: {
          teamIds: getProjectTeamIds(binding.project),
          projectIds: [binding.project._id],
          includeHub: true,
        },
      };
    }
    if (binding.kind === 'org_run') {
      return {
        allowed: true,
        scope: { teamIds: [], projectIds: [], includeHub: true },
      };
    }
    if (args.userId !== undefined) {
      const access = await resolveAgentReadAccess(ctx, {
        organizationId: args.organizationId,
        userId: args.userId,
        subject: args.subject,
      });
      if (!access.allowed) {
        return { allowed: false, reason: access.reason };
      }
      return {
        allowed: true,
        scope: await resolveKnowledgeAccessForUser(ctx, {
          organizationId: args.organizationId,
          userId: args.userId,
        }),
      };
    }
    return { allowed: false, reason: 'no_access_context' };
  },
});
