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
import {
  checkProjectAccess,
  hasProjectAccess,
  isOrgWideProject,
} from './access';
import { getProjectAccessibleUserIds } from './accessible_members';
import {
  projectConnectorsModeValidator,
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
  // Denormalized rollups — see the bucket semantics on `projectsTable`.
  openTaskCount: v.optional(v.number()),
  doneTaskCount: v.optional(v.number()),
  projectAgentCount: v.optional(v.number()),
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
  connectorsMode: v.optional(projectConnectorsModeValidator),
  allowedConnectorSlugs: v.optional(v.array(v.string())),
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

type VisibleProject = Doc<'projects'> & {
  isOrgWide: boolean;
  canEdit: boolean;
  canAdminister: boolean;
};

/**
 * The org's projects this caller may see, newest-touched first, each stamped
 * with its per-row access flags. Shared by `listProjects` and
 * `listProjectsOverview` so the two can never drift on access semantics.
 */
async function collectVisibleProjects(
  ctx: QueryCtx,
  auth: { role: string; teamIds: string[] },
  args: { organizationId: string; includeArchived?: boolean },
): Promise<VisibleProject[]> {
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

  const visible: VisibleProject[] = [];

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
}

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
 * projects, follow up with a cursor page like the chat archive's
 * `listArchivedThreads`. UI today consumes the full list and filters
 * in-memory.
 */
export const listProjects = query({
  args: {
    organizationId: v.string(),
    includeArchived: v.optional(v.boolean()),
  },
  returns: v.array(projectListItemValidator),
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx, args.organizationId);
    return await collectVisibleProjects(ctx, auth, args);
  },
});

/** Terminal task statuses — an overdue due date on one of these is history. */
const TERMINAL_TASK_STATUSES = new Set(['done', 'cancelled']);

/**
 * Bound for the derived overdue walk. GLOBAL to the scan, so a truncated walk
 * makes every project's overdue number a lower bound — which is why the flag
 * is returned once for the whole result rather than per row.
 */
const PROJECT_OVERDUE_SCAN_CAP = 2000;

const projectOverviewRowValidator = v.object({
  ...projectListItemValidator.fields,
  openTaskCount: v.number(),
  doneTaskCount: v.number(),
  overdueTaskCount: v.number(),
  projectAgentCount: v.number(),
});

/**
 * The projects LIST page's read: every visible project plus the at-a-glance
 * rollups its row renders.
 *
 * Deliberately separate from `listProjects` rather than an extension of it —
 * that query is also subscribed on every chat page and called server-side from
 * an action, none of which need these numbers, and its row validator is shared
 * with `getProject`.
 *
 * Cost is ONE bounded index walk regardless of project count, never one walk
 * per project: task open/done and agent counts are read straight off the
 * denormalized project row (see the bucket semantics on `projectsTable`), and
 * overdue is derived from a single `by_org_dueDate` range scan.
 */
export const listProjectsOverview = query({
  args: {
    organizationId: v.string(),
    includeArchived: v.optional(v.boolean()),
    /**
     * The clock the overdue derive compares against. Passed by the client and
     * bucketed there, because `Date.now()` inside a query is the transaction
     * start time and a cached query result does NOT re-run when the clock
     * moves — only when a data dependency changes. Without a rotating arg, a
     * quiet org's overdue count would sit stale indefinitely.
     */
    asOf: v.optional(v.number()),
  },
  returns: v.object({
    projects: v.array(projectOverviewRowValidator),
    overdueTruncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx, args.organizationId);
    const visible = await collectVisibleProjects(ctx, auth, args);
    const visibleIds = new Set(visible.map((p) => String(p._id)));
    const now = args.asOf ?? Date.now();

    // --- Overdue ---------------------------------------------------------
    // Same idiom as `sweepOverdueLadder`: `.gt('dueDate', 0)` is what skips
    // rows with no due date at all (undefined sorts first).
    const overdueByProject = new Map<string, number>();
    let overdueScanned = 0;
    let overdueTruncated = false;
    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_org_dueDate', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .gt('dueDate', 0)
          .lte('dueDate', now),
      )) {
      if (overdueScanned >= PROJECT_OVERDUE_SCAN_CAP) {
        overdueTruncated = true;
        break;
      }
      overdueScanned += 1;
      if (task.archivedAt || TERMINAL_TASK_STATUSES.has(task.status)) continue;
      const key = String(task.projectId);
      // Both walks are org-wide, so they see rows in projects this caller
      // cannot open. That is not a leak: every bucket is keyed by the row's own
      // projectId and only visible projects' keys are ever read back, so an
      // invisible project's tasks can never land in a visible one's number.
      // This skip is purely to stop the map growing keys nobody reads.
      if (!visibleIds.has(key)) continue;
      overdueByProject.set(key, (overdueByProject.get(key) ?? 0) + 1);
    }

    return {
      // `Object.assign` rather than a spread: `collectVisibleProjects` already
      // built each of these objects fresh for this call, so mutating in place
      // is safe and avoids re-allocating every row a second time.
      projects: visible.map((project) => {
        const key = String(project._id);
        return Object.assign(project, {
          openTaskCount: project.openTaskCount ?? 0,
          doneTaskCount: project.doneTaskCount ?? 0,
          projectAgentCount: project.projectAgentCount ?? 0,
          overdueTaskCount: overdueByProject.get(key) ?? 0,
        });
      }),
      overdueTruncated,
    };
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
  model: v.optional(v.string()),
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
      /** Who put the file here — `upload` for a person, `agent` for a file a
       * run filed. The task surface reads it to tell input from outcome. */
      sourceProvider: v.optional(v.string()),
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
        sourceProvider: d.sourceProvider,
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
