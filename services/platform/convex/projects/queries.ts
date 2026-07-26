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
import { getDocumentRagProjectionBatch } from '../documents/get_document_rag_projection';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { isActiveOrg } from '../lib/rls/organization/assert_active_org';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { blobRefValidator } from '../lib/storage/blob_ref';
import { listByOrganizationHandler } from '../members/queries';
import { isHiddenFromChatHistory } from '../threads/list_threads';
import {
  checkProjectAccess,
  hasProjectAccess,
  isOrgWideProject,
} from './access';
import { getProjectAccessibleUserIds } from './accessible_members';
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
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) throw new Error('Unauthenticated');

  const member = await getOrganizationMember(ctx, organizationId, authUser);
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
  taskLabelColors: v.optional(v.record(v.string(), v.string())),
  teamId: v.optional(v.string()),
  sharedWithTeamIds: v.optional(v.array(v.string())),
  instructions: v.optional(v.string()),
  knowledgeMode: v.optional(projectKnowledgeModeValidator),
  agentMode: v.optional(projectModeValidator),
  recommendedAgentSlugs: v.optional(v.array(v.string())),
  allowedAgentSlugs: v.optional(v.array(v.string())),
  // DEPRECATED (never released) — Phase A per-harness binding, replaced by
  // `projectAgents` rows. Kept ONLY because these handlers spread whole docs
  // and dev deployments still carry the field; no client reads it. Drops with
  // the schema field in the roster-retirement cleanup.
  agentCapabilities: v.optional(
    v.record(
      v.string(),
      v.object({
        skills: v.array(v.string()),
        connectors: v.array(v.string()),
      }),
    ),
  ),
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
 * The user IDs that can be ASSIGNED work in a project — i.e. those who can
 * access it. Powers the task assignee picker + `@`-mention autocomplete so they
 * never offer a user who cannot see the project (see `use-actor-directory`).
 *
 * `orgWide: true` (with empty `userIds`) means no team restriction — the client
 * shows every non-disabled member. Otherwise `userIds` is the exact accessible
 * set (admins/owners ∪ the project's team members). Fails closed to
 * `{ orgWide: false, userIds: [] }` when the project isn't in the active org or
 * the caller can't read it.
 */
export const listAccessibleUserIds = query({
  args: { organizationId: v.string(), projectId: v.id('projects') },
  returns: v.object({ orgWide: v.boolean(), userIds: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || !isActiveOrg(project.organizationId, args.organizationId)) {
      return { orgWide: false, userIds: [] };
    }
    const auth = await getAuthContext(ctx, args.organizationId);
    if (!hasProjectAccess(project, auth.teamIds, auth.role)) {
      return { orgWide: false, userIds: [] };
    }
    const set = await getProjectAccessibleUserIds(ctx, project);
    return set === null
      ? { orgWide: true, userIds: [] }
      : { orgWide: false, userIds: [...set] };
  },
});

/**
 * Get a single project by id. Throws if the caller cannot read it.
 */
export const getProject = query({
  args: { projectId: v.id('projects'), organizationId: v.string() },
  returns: v.union(
    v.object({
      ...projectListItemValidator.fields,
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    // Active-org coherence: a project carried over from another org (stale URL,
    // warm cache) resolves to "not found", not the other org's content.
    if (!project || !isActiveOrg(project.organizationId, args.organizationId)) {
      return null;
    }

    const auth = await getAuthContext(ctx, args.organizationId);
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

const projectAgentRowValidator = v.object({
  _id: v.id('projectAgents'),
  _creationTime: v.number(),
  organizationId: v.string(),
  projectId: v.id('projects'),
  name: v.string(),
  harness: v.string(),
  skills: v.array(v.string()),
  connectors: v.array(v.string()),
  instructions: v.optional(v.string()),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/**
 * The project's user-created agents, name-sorted, for the Agents tab and the
 * task assignee picker. Fails closed to an empty list when the project is
 * missing, in another org, or unreadable — same posture as
 * `listAccessibleUserIds` (the tab renders under an access-gated shell; a
 * reactive race must not throw).
 */
export const listProjectAgents = query({
  args: { projectId: v.id('projects'), organizationId: v.string() },
  returns: v.array(projectAgentRowValidator),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || !isActiveOrg(project.organizationId, args.organizationId)) {
      return [];
    }
    const auth = await getAuthContext(ctx, args.organizationId);
    if (!hasProjectAccess(project, auth.teamIds, auth.role)) {
      return [];
    }
    const agents = await ctx.db
      .query('projectAgents')
      .withIndex('by_project', (q) => q.eq('projectId', args.projectId))
      .collect();
    return agents.sort((a, b) => a.name.localeCompare(b.name));
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
  args: { projectId: v.id('projects'), organizationId: v.string() },
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
    if (!project || !isActiveOrg(project.organizationId, args.organizationId)) {
      return null;
    }
    const auth = await getAuthContext(ctx, args.organizationId);
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
    // Indexed state is projected from fileMetadata.ragStatus (canonical), not
    // the retired documents.indexed flag.
    const ragProjections = await getDocumentRagProjectionBatch(ctx, docsPage);
    const indexedFileCount = docsPage.filter(
      (d) => ragProjections.get(String(d._id))?.indexed === true,
    ).length;

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
  args: { projectId: v.id('projects'), organizationId: v.string() },
  returns: v.array(
    v.object({
      _id: v.id('documents'),
      _creationTime: v.number(),
      title: v.optional(v.string()),
      fileId: v.optional(blobRefValidator),
      mimeType: v.optional(v.string()),
      extension: v.optional(v.string()),
      folderId: v.optional(v.id('folders')),
      indexed: v.optional(v.boolean()),
      ragStatus: v.union(
        v.literal('queued'),
        v.literal('running'),
        v.literal('completed'),
        v.literal('failed'),
        v.literal('unsupported'),
        v.null(),
      ),
      createdBy: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || !isActiveOrg(project.organizationId, args.organizationId)) {
      return [];
    }
    const auth = await getAuthContext(ctx, args.organizationId);
    if (!hasProjectAccess(project, auth.teamIds, auth.role)) return [];

    const rawDocs = await ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_projectId', (q) =>
        q
          .eq('organizationId', project.organizationId)
          .eq('projectId', args.projectId),
      )
      .order('desc')
      .collect();

    // RAG status/indexed projected from fileMetadata.ragStatus (canonical).
    const ragProjections = await getDocumentRagProjectionBatch(ctx, rawDocs);
    return rawDocs.map((d) => {
      const proj = ragProjections.get(String(d._id));
      return {
        _id: d._id,
        _creationTime: d._creationTime,
        title: d.title,
        fileId: d.fileId,
        mimeType: d.mimeType,
        extension: d.extension,
        folderId: d.folderId,
        indexed: proj?.indexed ?? false,
        ragStatus: proj?.status ?? null,
        createdBy: d.createdBy,
      };
    });
  },
});

/**
 * Every folder of a project, flat — the Knowledge tab assembles the tree
 * client-side (projects hold at most a few hundred folders; no pagination
 * or lazy loading warranted). Same access rule as `listProjectDocuments`.
 */
export const listProjectFolders = query({
  args: { projectId: v.id('projects'), organizationId: v.string() },
  returns: v.array(
    v.object({
      _id: v.id('folders'),
      name: v.string(),
      parentId: v.optional(v.id('folders')),
    }),
  ),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || !isActiveOrg(project.organizationId, args.organizationId)) {
      return [];
    }
    const auth = await getAuthContext(ctx, args.organizationId);
    if (!hasProjectAccess(project, auth.teamIds, auth.role)) return [];

    const folders = await ctx.db
      .query('folders')
      .withIndex('by_org_project_parent_name', (q) =>
        q
          .eq('organizationId', project.organizationId)
          .eq('projectId', args.projectId),
      )
      .collect();

    return folders.map((f) => ({
      _id: f._id,
      name: f.name,
      parentId: f.parentId,
    }));
  },
});

/**
 * Top-level setup folder for a project, or null when `setupFolderName` is
 * empty / the folder is absent. Callers (desk packs) pass the folder name —
 * the platform never hardcodes a product-specific setup slug.
 */
async function findProjectSetupFolder(
  ctx: QueryCtx,
  organizationId: string,
  projectId: Id<'projects'>,
  setupFolderName: string,
): Promise<Doc<'folders'> | null> {
  // Same root filter as listProjectRootFolders — do not pin parentId on the
  // index (omitted-at-insert parentId can miss an eq(undefined) probe).
  const folders = await ctx.db
    .query('folders')
    .withIndex('by_org_project_parent_name', (q) =>
      q.eq('organizationId', organizationId).eq('projectId', projectId),
    )
    .collect();
  return (
    folders.find(
      (f) => f.parentId === undefined && f.name === setupFolderName,
    ) ?? null
  );
}

/**
 * Top-level folders of a project (parentId unset). Same access rule as
 * `listProjectFolders`. Used by desk UIs that treat each root folder as a
 * quarter / period.
 *
 * When `setupFolderName` is set, that root is excluded from the list and its
 * id is repeated on every row as `setupFolderId` so Start can bind
 * `externalUrl` without a second query. When omitted, every root is returned
 * and `setupFolderId` is null.
 */
export const listProjectRootFolders = query({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
    /** Pack-declared setup root to exclude (e.g. `_setup` from a desk view). */
    setupFolderName: v.optional(v.string()),
    /**
     * When set, each row's `hasTask` is true iff a project-scoped task already
     * exists for `(externalSystem, folderId as externalId)` — the same natural
     * key desk Start uses via `createTaskFromExternalIssue`. Packs pass the
     * same `externalSystem` string they use on create / Returns list; omit to
     * leave `hasTask` false (Start gating stays pack-declared via `when`).
     */
    externalSystem: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      _id: v.id('folders'),
      name: v.string(),
      setupFolderId: v.union(v.id('folders'), v.null()),
      hasTask: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || !isActiveOrg(project.organizationId, args.organizationId)) {
      return [];
    }
    const auth = await getAuthContext(ctx, args.organizationId);
    if (!hasProjectAccess(project, auth.teamIds, auth.role)) return [];

    // Collect every project folder (same index prefix as listProjectFolders),
    // then keep roots in memory. Pinning `parentId: undefined` on the index
    // can miss rows whose parentId field was omitted at insert (Convex strips
    // undefined on write) depending on index encoding — filter is the safe
    // match for "top-level".
    const folders = await ctx.db
      .query('folders')
      .withIndex('by_org_project_parent_name', (q) =>
        q
          .eq('organizationId', project.organizationId)
          .eq('projectId', args.projectId),
      )
      .collect();

    const roots = folders.filter((f) => f.parentId === undefined);
    const setupName = args.setupFolderName?.trim() || null;
    const setupFolderId = setupName
      ? (roots.find((f) => f.name === setupName)?._id ?? null)
      : null;

    const taskExternalIds = new Set<string>();
    const externalSystem = args.externalSystem?.trim();
    if (externalSystem) {
      const tasks = await ctx.db
        .query('tasks')
        .withIndex('by_project_external', (q) =>
          q
            .eq('projectId', args.projectId)
            .eq('externalSystem', externalSystem),
        )
        .collect();
      for (const task of tasks) {
        if (task.externalId) taskExternalIds.add(task.externalId);
      }
    }

    return roots
      .filter((f) => (setupName ? f.name !== setupName : true))
      .map((f) => ({
        _id: f._id,
        name: f.name,
        setupFolderId,
        hasTask: taskExternalIds.has(f._id),
      }));
  },
});

/**
 * A project's top-level setup folder by pack-declared name, or null when
 * `setupFolderName` is empty / the folder is absent / inaccessible. Same
 * access rule as `listProjectFolders`.
 */
export const getProjectSetupFolder = query({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
    setupFolderName: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id('folders'),
      name: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const setupName = args.setupFolderName.trim();
    if (!setupName) return null;

    const project = await ctx.db.get(args.projectId);
    if (!project || !isActiveOrg(project.organizationId, args.organizationId)) {
      return null;
    }
    const auth = await getAuthContext(ctx, args.organizationId);
    if (!hasProjectAccess(project, auth.teamIds, auth.role)) return null;

    const folder = await findProjectSetupFolder(
      ctx,
      project.organizationId,
      args.projectId,
      setupName,
    );
    if (!folder) return null;
    return { _id: folder._id, name: folder.name };
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
      /** Author's display name, resolved from org membership. Absent when the
       *  author is no longer a member or the org exceeds the listing cap;
       *  callers fall back to a userId fragment. */
      authorName: v.optional(v.string()),
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

    // Resolve author display names once so shared threads show a name rather
    // than a raw userId fragment. Degrades gracefully to the fallback when a
    // member can't be resolved.
    const authorNames = new Map<string, string>();
    try {
      const members = await listByOrganizationHandler(ctx, {
        organizationId: project.organizationId,
      });
      for (const member of members) {
        if (member.displayName)
          authorNames.set(member.userId, member.displayName);
      }
    } catch (error) {
      console.warn(
        '[projects] listProjectThreads: author name resolution failed',
        error,
      );
    }

    const threadsQuery = ctx.db
      .query('threadMetadata')
      .withIndex('by_organizationId_and_projectId', (q) =>
        q
          .eq('organizationId', project.organizationId)
          .eq('projectId', args.projectId),
      );

    const result = [];
    for await (const t of threadsQuery) {
      // Task-comment threads and fork branches reuse threadMetadata but are
      // not chats — they live under their own surfaces, not the project's
      // chat list. Same rule as the main chat history (see
      // `excludeNonChatHistoryThreads`).
      if (isHiddenFromChatHistory(t)) continue;
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
        authorName: authorNames.get(t.userId),
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
