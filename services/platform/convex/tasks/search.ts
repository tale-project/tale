/**
 * Task search for the ⌘K palette and the project Tasks toolbar — a bounded,
 * recency-biased scan over the caller's readable projects.
 *
 * Full-text search indexes are disabled repo-wide (see the
 * `TODO(search-index-disabled)` doctrine in `convex/lib/search/`), so this
 * walks the newest tasks in scope and, per task, its field text plus recent
 * discussion comments, AND-matching lowercased tokens. Caps mirror chat
 * search: recent work is where searches land, and a bounded miss beats an
 * unbounded walk.
 */

import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { query, type QueryCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { hasProjectAccess } from '../projects/access';
import { readTaskDiscussionMessages } from './internal_queries';

/** Newest tasks examined per search (org-wide or project-scoped). */
const SCAN_TASKS = 80;
/** Newest discussion comments examined per task. */
const SCAN_COMMENTS = 30;
/** Results returned at most. */
const MAX_RESULTS = 25;
/** Snippet budget — enough context, never a whole essay. */
const SNIPPET_MAX_CHARS = 600;

function matchesEveryToken(
  haystack: string,
  tokens: readonly string[],
): boolean {
  return tokens.every((token) => haystack.includes(token));
}

/** Field text searchable without loading the discussion thread. */
export function taskFieldHaystack(
  task: Pick<Doc<'tasks'>, 'title' | 'description' | 'externalId' | 'number'>,
  projectKey?: string,
): string {
  const identifier =
    projectKey && task.number !== undefined
      ? `${projectKey}-${task.number}`
      : '';
  return [task.title, task.description ?? '', task.externalId ?? '', identifier]
    .join(' ')
    .toLowerCase();
}

/**
 * Readable projects in the org (live only) — same ACL as the all-projects
 * board. Keys are stamped so search hits can show `KEY-123`.
 */
async function collectReadableProjects(
  ctx: QueryCtx,
  organizationId: string,
  auth: { role: string; teamIds: string[] },
): Promise<{
  projectIds: Set<string>;
  projectKeys: Map<string, string | undefined>;
}> {
  const projectIds = new Set<string>();
  const projectKeys = new Map<string, string | undefined>();
  for await (const row of ctx.db
    .query('projects')
    .withIndex('by_organization_archived', (q) =>
      q.eq('organizationId', organizationId).eq('archivedAt', undefined),
    )) {
    if (!hasProjectAccess(row, auth.teamIds, auth.role)) continue;
    const id = String(row._id);
    projectIds.add(id);
    projectKeys.set(id, row.key);
  }
  return { projectIds, projectKeys };
}

export const searchTasks = query({
  args: {
    organizationId: v.string(),
    query: v.string(),
    /** Narrow to one project (Tasks toolbar). Omit for org-wide palette. */
    projectId: v.optional(v.id('projects')),
  },
  returns: v.array(
    v.object({
      taskId: v.id('tasks'),
      projectId: v.id('projects'),
      title: v.string(),
      snippet: v.string(),
      updatedAt: v.number(),
      number: v.optional(v.number()),
      projectKey: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }
    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );
    const teamIds = await getUserTeamIds(ctx, member.userId);
    const auth = { role: member.role, teamIds };

    const tokens = args.query
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 0);
    if (tokens.length === 0) return [];

    let projectIds: Set<string>;
    let projectKeys: Map<string, string | undefined>;

    if (args.projectId !== undefined) {
      const project = await ctx.db.get(args.projectId);
      if (
        !project ||
        project.organizationId !== args.organizationId ||
        project.archivedAt !== undefined ||
        !hasProjectAccess(project, auth.teamIds, auth.role)
      ) {
        return [];
      }
      projectIds = new Set([String(project._id)]);
      projectKeys = new Map([[String(project._id), project.key]]);
    } else {
      const readable = await collectReadableProjects(
        ctx,
        args.organizationId,
        auth,
      );
      projectIds = readable.projectIds;
      projectKeys = readable.projectKeys;
    }

    if (projectIds.size === 0) return [];

    const results: Array<{
      taskId: Id<'tasks'>;
      projectId: Id<'projects'>;
      title: string;
      snippet: string;
      updatedAt: number;
      number?: number;
      projectKey?: string;
    }> = [];

    let examined = 0;
    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_org_updatedAt', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')) {
      if (examined >= SCAN_TASKS) break;
      if (!projectIds.has(String(task.projectId))) continue;
      if (task.archivedAt) continue;
      examined += 1;
      if (results.length >= MAX_RESULTS) break;

      const projectKey = projectKeys.get(String(task.projectId));
      const fieldHaystack = taskFieldHaystack(task, projectKey);
      const fieldMatches = matchesEveryToken(fieldHaystack, tokens);

      let matchingComment: string | undefined;
      if (!fieldMatches && task.discussionThreadId) {
        const comments = await readTaskDiscussionMessages(ctx, task);
        const recent = comments.slice(-SCAN_COMMENTS).reverse();
        const hit = recent.find((comment) =>
          matchesEveryToken(comment.body.toLowerCase(), tokens),
        );
        if (hit) matchingComment = hit.body;
      }

      if (!fieldMatches && matchingComment === undefined) continue;

      const snippetSource =
        matchingComment !== undefined
          ? matchingComment
          : (task.description ?? task.title);

      results.push({
        taskId: task._id,
        projectId: task.projectId,
        title: task.title,
        snippet: snippetSource.trim().slice(0, SNIPPET_MAX_CHARS),
        updatedAt: task.updatedAt,
        ...(task.number !== undefined ? { number: task.number } : {}),
        ...(projectKey !== undefined ? { projectKey } : {}),
      });
    }

    return results;
  },
});
