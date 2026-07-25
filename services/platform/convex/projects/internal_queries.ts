/**
 * Internal queries for the projects feature.
 *
 * These are called from server-only contexts (actions in
 * `lib/agent_response/build_project_instructions.ts` and the chat send
 * path) where the regular `ctx.db` access isn't available. Always
 * resolved without identity checks — callers (which already established
 * org + project access) pass the validated projectId.
 */

import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalQuery, type QueryCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getOrganizationMember } from '../lib/rls';
import { hasProjectAccess } from './access';

/**
 * Load a project record for chat-time injection. Returns the minimal
 * shape the prompt builder needs.
 */
export const getProjectForInjection = internalQuery({
  args: { projectId: v.id('projects') },
  returns: v.union(
    v.object({
      _id: v.id('projects'),
      name: v.string(),
      instructions: v.optional(v.string()),
      knowledgeMode: v.optional(
        v.union(
          v.literal('off'),
          v.literal('tool'),
          v.literal('context'),
          v.literal('both'),
        ),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return null;
    return {
      _id: project._id,
      name: project.name,
      instructions: project.instructions,
      knowledgeMode: project.knowledgeMode,
    };
  },
});

/**
 * The agent slugs a project restricts chat to, if any. Used by Auto routing
 * so a project-scoped "Auto" send only routes to agents on the project's
 * allow-list. Returns `[]` when the project pins no agents (no restriction)
 * or doesn't resolve — both mean "don't narrow the candidate set".
 */
export const getProjectAllowedAgentSlugs = internalQuery({
  args: { projectId: v.id('projects') },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    return project?.allowedAgentSlugs ?? [];
  },
});

/**
 * A thread's project link, wherever it lives: a rebuilt chat thread carries
 * `threads.projectId` (set at creation from the project's "New chat" flow);
 * a discussion/task thread carries `threadMetadata.projectId`. ONE resolver
 * so no caller ever picks a side.
 */
async function projectIdForThread(
  ctx: QueryCtx,
  threadId: string,
): Promise<Id<'projects'> | null> {
  const chatThreadId = ctx.db.normalizeId('threads', threadId);
  if (chatThreadId !== null) {
    const thread = await ctx.db.get(chatThreadId);
    if (thread?.projectId) return thread.projectId;
  }
  const meta = await ctx.db
    .query('threadMetadata')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .first();
  return meta?.projectId ?? null;
}

/**
 * Load the projectId for a thread, if any. Used by chat runtime to
 * resolve the project context from a thread that already has it
 * persisted (e.g., follow-up message in an existing project thread).
 */
export const getProjectIdForThread = internalQuery({
  args: { threadId: v.string() },
  returns: v.union(v.id('projects'), v.null()),
  handler: async (ctx, args) => {
    return await projectIdForThread(ctx, args.threadId);
  },
});

/**
 * The skills + connectors a project has bound to one agent, resolved from a
 * thread. Phase B consumption: an external turn in a project thread runs its agent
 * PRE-EQUIPPED with this binding — the persistent project baseline, which the
 * turn unions with the conversation's own composer picks. Returns empty lists
 * when the thread is not in a project, the project is gone, or the agent has no
 * binding — all of which mean "nothing bound; use only the conversation's
 * picks". `agentId` is the agent's harness slug (the binding's key).
 */
export const getProjectAgentCapabilitiesForThread = internalQuery({
  args: { threadId: v.string(), agentId: v.string() },
  returns: v.object({
    skills: v.array(v.string()),
    connectors: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const projectId = await projectIdForThread(ctx, args.threadId);
    if (projectId === null) return { skills: [], connectors: [] };
    const project = await ctx.db.get(projectId);
    const binding = project?.agentCapabilities?.[args.agentId];
    if (!binding) return { skills: [], connectors: [] };
    return { skills: binding.skills, connectors: binding.connectors };
  },
});

/**
 * Server-side defense-in-depth for the chat send path. The composer UI
 * already enforces `hasProjectAccess`, but a direct API call must not
 * bypass it. Returns a structured allow/deny shape so the caller can
 * map to typed ConvexError codes.
 *
 * Outcomes:
 *  - `{ allowed: true }` — the user is in the project (admin / owning
 *    team / shared team / org-wide).
 *  - `{ allowed: false, reason: 'not_found' }` — projectId doesn't
 *    resolve. Map to `PROJECT_NOT_FOUND`.
 *  - `{ allowed: false, reason: 'forbidden' }` — caller is in the org
 *    but not in any team that has access. Map to `PROJECT_FORBIDDEN`.
 *  - `{ allowed: false, reason: 'org_mismatch' }` — projectId belongs
 *    to a different organization than the chat call. Map to
 *    `PROJECT_FORBIDDEN`.
 */
export const assertProjectAccessForChat = internalQuery({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
    userId: v.string(),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(
      v.union(
        v.literal('not_found'),
        v.literal('forbidden'),
        v.literal('org_mismatch'),
      ),
    ),
  }),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return { allowed: false, reason: 'not_found' as const };
    if (project.organizationId !== args.organizationId) {
      return { allowed: false, reason: 'org_mismatch' as const };
    }

    // Resolve caller's org role + team membership.
    try {
      const member = await getOrganizationMember(ctx, args.organizationId, {
        userId: args.userId,
        email: undefined,
        name: undefined,
      });
      const teamIds = await getUserTeamIds(ctx, member.userId);
      if (!hasProjectAccess(project, teamIds, member.role)) {
        return { allowed: false, reason: 'forbidden' as const };
      }
      return { allowed: true };
    } catch {
      return { allowed: false, reason: 'forbidden' as const };
    }
  },
});

/**
 * Idempotency probe for the starter-content seeder: returns true when the org
 * already has at least one project, so `seed_starter` never duplicates the
 * "Getting started" example content on a re-run.
 */
export const orgHasAnyProject = internalQuery({
  args: { organizationId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const first = await ctx.db
      .query('projects')
      .withIndex('by_organization', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    return first !== null;
  },
});
