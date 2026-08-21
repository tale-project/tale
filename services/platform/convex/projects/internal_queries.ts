/**
 * Internal queries for the projects feature.
 *
 * These are called from server-only contexts (actions in
 * `lib/agent_response/build_project_instructions.ts` and the chat send
 * path) where the regular `ctx.db` access isn't available. Always
 * resolved without identity checks — callers (which already established
 * org + project access) pass the validated projectId.
 */

import { v, type Infer } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { internalQuery, type QueryCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getOrganizationMember } from '../lib/rls';
import { getProjectTeamIds, hasProjectAccess } from './access';
import { resolveProjectAccessForUser } from './resolve_project_access';

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
 * The skill-viewer scope of a project: its owning + shared team ids, where
 * an empty list means an org-wide project. `null` when the project does not
 * resolve. Skill listing and staging read team skills through this scope —
 * a project's equipment sees what the PROJECT may see, never what the member
 * configuring it may (see `lib/skills/visibility.ts`).
 */
export const getProjectSkillScope = internalQuery({
  args: { projectId: v.id('projects') },
  returns: v.union(v.object({ teamIds: v.array(v.string()) }), v.null()),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return null;
    return { teamIds: getProjectTeamIds(project) };
  },
});

/**
 * The skill-viewer scope of a project agent's project, resolved from the
 * agent row task runs carry. `null` when the agent or its project is gone.
 */
export const getProjectAgentSkillScope = internalQuery({
  args: { agentId: v.id('projectAgents') },
  returns: v.union(v.object({ teamIds: v.array(v.string()) }), v.null()),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    const project = await ctx.db.get(agent.projectId);
    if (!project) return null;
    return { teamIds: getProjectTeamIds(project) };
  },
});

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

/**
 * The projection REST lookups return for a project matched by id or by its
 * caller-owned external key — enough to identify the row and to see whether
 * the match is archived (`archivedAt` set), nothing more.
 */
const projectLookupValidator = v.object({
  _id: v.id('projects'),
  name: v.string(),
  key: v.optional(v.string()),
  description: v.optional(v.string()),
  externalItemId: v.optional(v.string()),
  archivedAt: v.optional(v.number()),
});

function toProjectLookup(
  project: Doc<'projects'>,
): Infer<typeof projectLookupValidator> {
  return {
    _id: project._id,
    name: project.name,
    key: project.key,
    description: project.description,
    externalItemId: project.externalItemId,
    archivedAt: project.archivedAt,
  };
}

/**
 * Look up a project by its caller-owned external key through
 * `by_organization_externalItemId`. The key is opaque and matched exactly as
 * stored (`createProject` stores it trimmed); archived projects match too —
 * per-org uniqueness ignores lifecycle, and the projection's `archivedAt`
 * tells the caller which case they hit.
 */
export const getProjectByExternalItemId = internalQuery({
  args: { organizationId: v.string(), externalItemId: v.string() },
  returns: v.union(projectLookupValidator, v.null()),
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query('projects')
      .withIndex('by_organization_externalItemId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('externalItemId', args.externalItemId),
      )
      .first();
    return project ? toProjectLookup(project) : null;
  },
});

/**
 * The minting user's access matrix on a project, for REST surfaces that must
 * re-run per-user visibility with an explicit userId. Takes the id as a wire
 * string: garbage, cross-org, and deleted ids all collapse into
 * `{canRead: false}` — exactly the shape an absent project answers, so the
 * caller's opaque-404 posture costs nothing extra. `canEdit` is the same
 * project-edit standard the session mutations apply (`checkProjectAccess`
 * via `resolveProjectAccessForUser`, failing closed on resolution errors).
 */
export const getProjectAccessForUser = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    projectId: v.string(),
  },
  returns: v.object({ canRead: v.boolean(), canEdit: v.boolean() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ canRead: boolean; canEdit: boolean }> => {
    const projectId = ctx.db.normalizeId('projects', args.projectId);
    if (projectId === null) return { canRead: false, canEdit: false };
    const access = await resolveProjectAccessForUser(ctx, projectId, {
      userId: args.userId,
      organizationId: args.organizationId,
    });
    return { canRead: access.canRead, canEdit: access.canEdit };
  },
});

/**
 * The same lookup projection, fetched by document id. Org-scoped: an id from
 * another organization — or a string that is not a project id at all —
 * resolves to null, so a REST caller cannot confirm that foreign ids exist.
 */
export const getProjectByIdForOrg = internalQuery({
  args: { organizationId: v.string(), projectId: v.string() },
  returns: v.union(projectLookupValidator, v.null()),
  handler: async (ctx, args) => {
    const projectId = ctx.db.normalizeId('projects', args.projectId);
    if (projectId === null) return null;
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== args.organizationId) {
      return null;
    }
    return toProjectLookup(project);
  },
});
