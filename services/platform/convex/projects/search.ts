/**
 * Project search for the global ⌘K palette — name, description, and key,
 * limited to projects the caller can read.
 */

import type { PaginationResult } from 'convex/server';
import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { query, type QueryCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { projectsSearchStrategy, runEntitySearch } from '../lib/search';
import { hasProjectAccess } from './access';

const MAX_RESULTS = 25;
const PAGE_SIZE = 50;
const SNIPPET_MAX_CHARS = 600;

function snippetForProject(project: Doc<'projects'>): string {
  const parts: string[] = [];
  if (project.key) parts.push(project.key);
  if (project.description?.trim()) parts.push(project.description.trim());
  const text = parts.join(' · ');
  if (text.length <= SNIPPET_MAX_CHARS) return text;
  return `${text.slice(0, SNIPPET_MAX_CHARS - 1)}…`;
}

async function collectProjectHits(
  ctx: QueryCtx,
  args: { organizationId: string; query: string },
  auth: { role: string; teamIds: string[] },
): Promise<
  Array<{
    projectId: Id<'projects'>;
    name: string;
    key?: string;
    snippet: string;
    updatedAt: number;
  }>
> {
  const hits: Array<{
    projectId: Id<'projects'>;
    name: string;
    key?: string;
    snippet: string;
    updatedAt: number;
  }> = [];
  let cursor: string | null = null;

  while (hits.length < MAX_RESULTS) {
    const page: PaginationResult<Doc<'projects'>> = await runEntitySearch(
      ctx,
      projectsSearchStrategy,
      {
        organizationId: args.organizationId,
        term: args.query,
        paginationOpts: { numItems: PAGE_SIZE, cursor },
        accessFilter: (row) =>
          row.archivedAt === undefined &&
          hasProjectAccess(row, auth.teamIds, auth.role),
      },
    );

    for (const row of page.page) {
      hits.push({
        projectId: row._id,
        name: row.name,
        key: row.key,
        snippet: snippetForProject(row),
        updatedAt: row.updatedAt,
      });
      if (hits.length >= MAX_RESULTS) break;
    }

    if (page.isDone) break;
    cursor = page.continueCursor;
    if (page.page.length === 0 && !page.isDone) continue;
  }

  return hits;
}

export const searchProjects = query({
  args: {
    organizationId: v.string(),
    query: v.string(),
  },
  returns: v.array(
    v.object({
      projectId: v.id('projects'),
      name: v.string(),
      key: v.optional(v.string()),
      snippet: v.string(),
      updatedAt: v.number(),
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
    const trimmed = args.query.trim();
    if (trimmed.length === 0) return [];

    return collectProjectHits(
      ctx,
      { organizationId: args.organizationId, query: trimmed },
      { role: member.role, teamIds },
    );
  },
});
