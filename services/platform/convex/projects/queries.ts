/**
 * Projects feature queries.
 *
 * Read-side surface for the Projects table. All queries enforce
 * `organizationId` scoping + per-row team-based access via
 * `hasProjectAccess` (from `./access`).
 */

import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { query, type QueryCtx } from '../_generated/server';
import { authComponent } from '../auth';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getOrganizationMember } from '../lib/rls';
import {
  checkProjectAccess,
  hasProjectAccess,
  isOrgWideProject,
} from './access';
import {
  projectIntegrationsModeValidator,
  projectKnowledgeModeValidator,
  projectModeValidator,
} from './schema';

async function getAuthContext(
  ctx: QueryCtx,
  organizationId: string,
): Promise<{
  userId: string;
  role: string;
  teamIds: string[];
}> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) throw new Error('Unauthenticated');

  const member = await getOrganizationMember(ctx, organizationId, {
    userId: String(authUser._id),
    email: authUser.email,
    name: authUser.name,
  });
  const teamIds = await getUserTeamIds(ctx, member.userId);
  return {
    userId: member.userId,
    role: member.role,
    teamIds,
  };
}

const projectRowValidator = v.object({
  _id: v.id('projects'),
  _creationTime: v.number(),
  organizationId: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  icon: v.optional(v.string()),
  color: v.optional(v.string()),
  key: v.optional(v.string()),
  taskCounter: v.optional(v.number()),
  teamId: v.optional(v.string()),
  sharedWithTeamIds: v.optional(v.array(v.string())),
  instructions: v.optional(v.string()),
  knowledgeMode: v.optional(projectKnowledgeModeValidator),
  agentMode: v.optional(projectModeValidator),
  recommendedAgentSlugs: v.optional(v.array(v.string())),
  allowedAgentSlugs: v.optional(v.array(v.string())),
  modelMode: v.optional(projectModeValidator),
  recommendedModels: v.optional(v.array(v.string())),
  allowedModels: v.optional(v.array(v.string())),
  integrationsMode: v.optional(projectIntegrationsModeValidator),
  allowedIntegrationSlugs: v.optional(v.array(v.string())),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  archivedAt: v.optional(v.number()),
  pinnedAt: v.optional(v.number()),
});

const projectListItemValidator = v.object({
  ...projectRowValidator.fields,
  isOrgWide: v.boolean(),
  canEdit: v.boolean(),
  canAdminister: v.boolean(),
});

/**
 * List all projects the caller can access within an organization.
 *
 * Filters per-row by `hasProjectAccess`. Returns enriched rows with
 * per-row access flags so the UI can gate edit/admin affordances without
 * a second query.
 *
 * S2: when `includeArchived` is false (the common path) we use the
 * `by_organization_archived` index with `archivedAt: undefined` so the
 * scan never visits archived rows. The fallback path (include archived)
 * walks `by_organization_updatedAt` to preserve recency ordering.
 *
 * Performance note: this query is unpaginated. For orgs with thousands of
 * projects, follow up with `paginationOptsValidator` (see
 * `convex/threads/list_threads.ts` for the pattern). UI today consumes
 * the full list and filters in-memory.
 */
export const listProjects = query({
  args: {
    organizationId: v.string(),
    includeArchived: v.optional(v.boolean()),
  },
  returns: v.array(projectListItemValidator),
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx, args.organizationId);

    const projectsQuery = args.includeArchived
      ? ctx.db
          .query('projects')
          .withIndex('by_organization_updatedAt', (q) =>
            q.eq('organizationId', args.organizationId),
          )
          .order('desc')
      : ctx.db
          .query('projects')
          .withIndex('by_organization_archived', (q) =>
            q
              .eq('organizationId', args.organizationId)
              .eq('archivedAt', undefined),
          );

    const visible: Array<
      Doc<'projects'> & {
        isOrgWide: boolean;
        canEdit: boolean;
        canAdminister: boolean;
      }
    > = [];

    for await (const row of projectsQuery) {
      if (!hasProjectAccess(row, auth.teamIds, auth.role)) continue;
      const access = checkProjectAccess(row, auth.teamIds, auth.role);
      visible.push({
        ...row,
        isOrgWide: isOrgWideProject(row),
        canEdit: access.canEdit,
        canAdminister: access.canAdminister,
      });
    }

    // When using by_organization_archived, the rows come out in insertion
    // order — sort by updatedAt desc to match the includeArchived branch.
    if (!args.includeArchived) {
      visible.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    return visible;
  },
});

/**
 * Get a single project by id. Throws if the caller cannot read it.
 */
export const getProject = query({
  args: { projectId: v.id('projects') },
  returns: v.union(
    v.object({
      ...projectListItemValidator.fields,
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return null;

    const auth = await getAuthContext(ctx, project.organizationId);
    if (!hasProjectAccess(project, auth.teamIds, auth.role)) {
      return null;
    }
    const access = checkProjectAccess(project, auth.teamIds, auth.role);

    return {
      ...project,
      isOrgWide: isOrgWideProject(project),
      canEdit: access.canEdit,
      canAdminister: access.canAdminister,
    };
  },
});

/**
 * Counts for the Overview tab.
 *
 * H5: capped at 500 docs + 500 threads to bound memory for very large
 * projects. The UI surfaces a `truncated` flag and renders "500+" in the
 * count cells when the cap is hit. Follow-up if metrics show frequent
 * truncation: maintain counter-style fields on the project row at
 * mutation time for O(1) overview.
 */
const PROJECT_STATS_CAP = 500;

export const getProjectStats = query({
  args: { projectId: v.id('projects') },
  returns: v.union(
    v.object({
      fileCount: v.number(),
      indexedFileCount: v.number(),
      threadCount: v.number(),
      sharedThreadCount: v.number(),
      lastActivityAt: v.union(v.number(), v.null()),
      truncated: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return null;
    const auth = await getAuthContext(ctx, project.organizationId);
    if (!hasProjectAccess(project, auth.teamIds, auth.role)) return null;

    // Take one extra so we can detect truncation without a second query.
    const docs = await ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_projectId', (q) =>
        q
          .eq('organizationId', project.organizationId)
          .eq('projectId', args.projectId),
      )
      .take(PROJECT_STATS_CAP + 1);
    const docsTruncated = docs.length > PROJECT_STATS_CAP;
    const docsPage = docsTruncated ? docs.slice(0, PROJECT_STATS_CAP) : docs;
    const indexedFileCount = docsPage.filter((d) => d.indexed === true).length;

    const threads = await ctx.db
      .query('threadMetadata')
      .withIndex('by_organizationId_and_projectId', (q) =>
        q
          .eq('organizationId', project.organizationId)
          .eq('projectId', args.projectId),
      )
      .take(PROJECT_STATS_CAP + 1);
    const threadsTruncated = threads.length > PROJECT_STATS_CAP;
    const threadsPage = threadsTruncated
      ? threads.slice(0, PROJECT_STATS_CAP)
      : threads;
    const sharedThreadCount = threadsPage.filter(
      (t) => t.sharedWithProject === true,
    ).length;

    const allActivityTimestamps: number[] = [
      project.updatedAt,
      ...docsPage.map((d) => d._creationTime),
      ...threadsPage.map((t) => t.updatedAt ?? t.createdAt),
    ].filter((n): n is number => typeof n === 'number');

    const lastActivityAt =
      allActivityTimestamps.length > 0
        ? Math.max(...allActivityTimestamps)
        : null;

    return {
      fileCount: docsPage.length,
      indexedFileCount,
      threadCount: threadsPage.length,
      sharedThreadCount,
      lastActivityAt,
      truncated: docsTruncated || threadsTruncated,
    };
  },
});

/**
 * List documents attached to a project. Used by the Files tab.
 */
export const listProjectDocuments = query({
  args: { projectId: v.id('projects') },
  returns: v.array(
    v.object({
      _id: v.id('documents'),
      _creationTime: v.number(),
      title: v.optional(v.string()),
      fileId: v.optional(v.id('_storage')),
      mimeType: v.optional(v.string()),
      extension: v.optional(v.string()),
      indexed: v.optional(v.boolean()),
      ragStatus: v.union(
        v.literal('queued'),
        v.literal('running'),
        v.literal('completed'),
        v.literal('failed'),
        v.null(),
      ),
      createdBy: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return [];
    const auth = await getAuthContext(ctx, project.organizationId);
    if (!hasProjectAccess(project, auth.teamIds, auth.role)) return [];

    const docsQuery = ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_projectId', (q) =>
        q
          .eq('organizationId', project.organizationId)
          .eq('projectId', args.projectId),
      )
      .order('desc');

    const docs = [];
    for await (const d of docsQuery) {
      docs.push({
        _id: d._id,
        _creationTime: d._creationTime,
        title: d.title,
        fileId: d.fileId,
        mimeType: d.mimeType,
        extension: d.extension,
        indexed: d.indexed,
        ragStatus: d.ragInfo?.status ?? null,
        createdBy: d.createdBy,
      });
    }
    return docs;
  },
});

/**
 * List threads inside a project. The caller chooses scope:
 *   - 'mine'   only the caller's threads (regardless of shared flag)
 *   - 'shared' threads with sharedWithProject=true (regardless of owner)
 *   - 'all'    union of the above (visible per §6.3 of the plan)
 */
export const listProjectThreads = query({
  args: {
    projectId: v.id('projects'),
    scope: v.union(v.literal('mine'), v.literal('shared'), v.literal('all')),
  },
  returns: v.array(
    v.object({
      _id: v.id('threadMetadata'),
      threadId: v.string(),
      userId: v.string(),
      title: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.optional(v.number()),
      sharedWithProject: v.optional(v.boolean()),
      status: v.string(),
      agentSlug: v.optional(v.string()),
      generationStatus: v.optional(
        v.union(v.literal('generating'), v.literal('idle')),
      ),
      isShared: v.optional(v.boolean()),
      pinnedAt: v.optional(v.number()),
      lastReplyAt: v.optional(v.number()),
      lastReadAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return [];
    const auth = await getAuthContext(ctx, project.organizationId);
    if (!hasProjectAccess(project, auth.teamIds, auth.role)) return [];

    const threadsQuery = ctx.db
      .query('threadMetadata')
      .withIndex('by_organizationId_and_projectId', (q) =>
        q
          .eq('organizationId', project.organizationId)
          .eq('projectId', args.projectId),
      );

    const result = [];
    for await (const t of threadsQuery) {
      // A deleted/trashed/expired chat leaves the project entirely (parity
      // with the chat list): deleting a project chat removes it from the
      // project view. `archived` is intentionally KEPT so an archived chat
      // stays reachable through its project.
      if (
        t.status === 'deleted' ||
        t.status === 'trashed' ||
        t.status === 'expired'
      ) {
        continue;
      }
      if (args.scope === 'mine' && t.userId !== auth.userId) continue;
      if (args.scope === 'shared' && t.sharedWithProject !== true) continue;
      if (
        args.scope === 'all' &&
        t.userId !== auth.userId &&
        t.sharedWithProject !== true
      ) {
        continue;
      }
      result.push({
        _id: t._id,
        threadId: t.threadId,
        userId: t.userId,
        title: t.title,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        sharedWithProject: t.sharedWithProject,
        status: t.status,
        agentSlug: t.agentSlug,
        generationStatus: t.generationStatus,
        isShared: t.isShared,
        pinnedAt: t.pinnedAt,
        lastReplyAt: t.lastReplyAt,
        lastReadAt: t.lastReadAt,
      });
    }
    return result;
  },
});

/**
 * Lightweight project search used by the in-composer ProjectPicker.
 * Hits the search index and post-filters by access.
 *
 * H9: We over-fetch `limit * 2` because the Convex search index can't
 * pre-filter by team membership. In high-deny orgs (many small teams,
 * caller in few of them) the post-filter can drop the result count below
 * `limit`. Acceptable trade-off; bump the multiplier if metrics show
 * frequently truncated returns.
 */
export const searchProjects = query({
  args: {
    organizationId: v.string(),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id('projects'),
      name: v.string(),
      icon: v.optional(v.string()),
      color: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx, args.organizationId);
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);

    // TODO(search-index-disabled): search_projects .searchIndex was dropped
    // to unblock deploy past SearchIndexBootstrapWorker crash loop. Re-enable
    // once the bootstrap is fixed; until then fall back to a scoped scan
    // of non-archived projects in the org, filtering by name substring.
    const searchLower = args.query.toLowerCase();
    const rows: Array<Doc<'projects'>> = [];
    const scan = ctx.db
      .query('projects')
      .withIndex('by_organization_archived', (q) =>
        q.eq('organizationId', args.organizationId).eq('archivedAt', undefined),
      );
    for await (const row of scan) {
      if (row.name.toLowerCase().includes(searchLower)) {
        rows.push(row);
        if (rows.length >= limit * 2) break;
      }
    }

    return rows
      .filter((row) => hasProjectAccess(row, auth.teamIds, auth.role))
      .slice(0, limit)
      .map((row) => ({
        _id: row._id,
        name: row.name,
        icon: row.icon,
        color: row.color,
      }));
  },
});

/**
 * Sidebar projects: capped list of the user's most-recently-updated
 * non-archived projects.
 *
 * S4: caps the walk at `limit * 5` rows considered. In very large orgs
 * with team segmentation, the post-filter may drop many rows; without the
 * ceiling, an extreme worst case would walk the entire index. The ceiling
 * keeps the scan bounded.
 */
export const listSidebarProjects = query({
  args: {
    organizationId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id('projects'),
      name: v.string(),
      icon: v.optional(v.string()),
      color: v.optional(v.string()),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx, args.organizationId);
    const limit = Math.min(Math.max(args.limit ?? 8, 1), 50);
    const scanCeiling = limit * 5;

    const rows = await ctx.db
      .query('projects')
      .withIndex('by_organization_updatedAt', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')
      .take(scanCeiling);

    const result: Array<{
      _id: Id<'projects'>;
      name: string;
      icon?: string;
      color?: string;
      updatedAt: number;
    }> = [];

    for (const row of rows) {
      if (row.archivedAt) continue;
      if (!hasProjectAccess(row, auth.teamIds, auth.role)) continue;
      result.push({
        _id: row._id,
        name: row.name,
        icon: row.icon,
        color: row.color,
        updatedAt: row.updatedAt,
      });
      if (result.length >= limit) break;
    }
    return result;
  },
});
