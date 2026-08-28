import type { Sql } from 'postgres';

import { findOrganizationMember } from '../../auth/membership.ts';
import type { ShimHandlers } from '../../lib/convex-shim.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { knowledgeShimHandlers } from '../knowledge/service.ts';
import {
  getProjectAuthContext,
  listProjects,
  type ProjectRow,
} from '../projects/service.ts';

/**
 * The handler map behind the reused 0.4 chat host (`executeTurn`) and tool
 * executor (`createChatToolExecutor`) — every `ctx.runQuery/runMutation`
 * those modules make, dispatched by function name onto 0.5 SQL.
 *
 * Three kinds of handler live here:
 *  - full ports (history read, attachment gate, project context, entity
 *    search legs over ported domains) — same semantics as their 0.4 twins;
 *  - governance seams answered permissively (`checkModelAccessInternal`
 *    allows, `getContextCapInternal` un-caps, `recordConnectorUsage`
 *    no-ops) until the governance domain ports — the MIGRATION.md ledger
 *    carries each one;
 *  - honest empties for corpora 0.5 has no tables for yet (knowledge
 *    entries, websites, mail conversations, video links) — an empty result
 *    is factually right against this database, and the tool layer already
 *    words empties for the model.
 *
 * Everything stays fail-loud for names NOT in this map — a new ctx call in
 * 0.4 surfaces as `[convex-shim] un-shimmed …` naming the function.
 */

// 0.4 pagination contract the entity legs expect. The 0.5 cursor is a plain
// row offset (stringified); the value is opaque to the model either way.
interface PageResult<T> {
  page: T[];
  isDone: boolean;
  continueCursor: string;
  /** searchTasks/ProjectsForChat stamp this on the explicit-list path. */
  listed?: boolean;
}

function emptyPage(): PageResult<never> {
  return { page: [], isDone: true, continueCursor: '' };
}

interface PaginationOpts {
  numItems: number;
  cursor: string | null;
}

function pageBounds(opts: PaginationOpts | undefined): {
  limit: number;
  offset: number;
} {
  const limit = Math.min(Math.max(opts?.numItems ?? 20, 1), 100);
  const parsed = opts?.cursor != null ? Number.parseInt(opts.cursor, 10) : 0;
  const offset = Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  return { limit, offset };
}

function pageOf<T>(
  rows: T[],
  bounds: { limit: number; offset: number },
  listed?: boolean,
): PageResult<T> {
  const page = rows.slice(0, bounds.limit);
  const isDone = rows.length <= bounds.limit;
  return {
    page,
    isDone,
    continueCursor: isDone ? '' : String(bounds.offset + bounds.limit),
    ...(listed !== undefined ? { listed } : {}),
  };
}

/** The turn user's knowledge scope — teams (+ the org pseudo-team), readable
 * projects, the hub — the 0.5 twin of `resolveKnowledgeAccessForUser`. */
async function resolveAccessScope(
  sql: Sql,
  organizationId: string,
  userId: string,
): Promise<{
  teamIds: string[];
  projectIds: string[];
  includeHub: boolean;
  archivedProjectIds: string[];
}> {
  const member = await findOrganizationMember(sql, organizationId, userId);
  if (member === null || member.role === 'disabled') {
    return {
      teamIds: [],
      projectIds: [],
      includeHub: false,
      archivedProjectIds: [],
    };
  }
  const auth = await getProjectAuthContext(sql, {
    organizationId,
    userId,
    role: member.role,
  });
  const projects = await listProjects(sql, auth, { includeArchived: true });
  return {
    teamIds: [...new Set([`org_${organizationId}`, ...auth.teamIds])],
    projectIds: projects.map((project) => project.id),
    includeHub: true,
    archivedProjectIds: projects
      .filter((project) => project.archivedAt !== null)
      .map((project) => project.id),
  };
}

interface TaskLegRow {
  _id: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  assigneeType?: string;
  assigneeId?: string;
  projectId?: string;
  dueDate?: number;
  archivedAt?: number;
}

const OPEN_EXCLUDED = ['done', 'cancelled'];

async function searchTasks(
  sql: Sql,
  args: {
    organizationId: string;
    projectIds: string[];
    term: string;
    status?: string;
    projectId?: string;
    list?: boolean;
    excludeArchived?: boolean;
    paginationOpts?: PaginationOpts;
  },
): Promise<PageResult<TaskLegRow>> {
  const readable =
    args.projectId !== undefined
      ? args.projectIds.filter((id) => id === args.projectId)
      : args.projectIds;
  if (readable.length === 0) {
    return { ...emptyPage(), ...(args.list === true ? { listed: true } : {}) };
  }
  const bounds = pageBounds(args.paginationOpts);
  const term = args.term.trim();
  const like = `%${term}%`;
  const status = args.status;
  const rows = await sql<TaskLegRow[]>`
    SELECT id AS "_id", title, description, status, priority,
           assignee_type AS "assigneeType", assignee_id AS "assigneeId",
           project_id AS "projectId", due_date_ms::float8 AS "dueDate",
           archived_at_ms::float8 AS "archivedAt"
    FROM app.tasks
    WHERE org_id = ${args.organizationId}
      AND project_id = ANY(${readable})
      AND (${args.list === true || term === ''} OR title ILIKE ${like}
           OR description ILIKE ${like})
      AND (${status === undefined}
           OR (${status ?? ''} = 'open' AND NOT (status = ANY(${OPEN_EXCLUDED})))
           OR status = ${status ?? ''})
      AND (${args.excludeArchived !== true} OR archived_at_ms IS NULL)
    ORDER BY updated_at_ms DESC
    LIMIT ${bounds.limit + 1} OFFSET ${bounds.offset}
  `;
  const nullsStripped = rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).filter(([, value]) => value !== null),
    ),
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- null-stripping keeps the selected shape, minus absent optionals
  return pageOf(nullsStripped as TaskLegRow[], bounds, args.list === true);
}

interface ProjectLegRow {
  _id: string;
  name: string;
  description?: string;
  key?: string;
  openTaskCount: number;
  doneTaskCount: number;
  archivedAt?: number;
}

async function searchProjects(
  sql: Sql,
  args: {
    organizationId: string;
    projectIds: string[];
    term: string;
    list?: boolean;
    paginationOpts?: PaginationOpts;
  },
): Promise<PageResult<ProjectLegRow>> {
  if (args.projectIds.length === 0) {
    return { ...emptyPage(), ...(args.list === true ? { listed: true } : {}) };
  }
  const bounds = pageBounds(args.paginationOpts);
  const term = args.term.trim();
  const like = `%${term}%`;
  const rows = await sql<ProjectLegRow[]>`
    SELECT id AS "_id", name, description, key,
           open_task_count AS "openTaskCount",
           done_task_count AS "doneTaskCount",
           archived_at_ms::float8 AS "archivedAt"
    FROM app.projects
    WHERE org_id = ${args.organizationId} AND id = ANY(${args.projectIds})
      AND (${args.list === true || term === ''} OR name ILIKE ${like}
           OR description ILIKE ${like} OR key ILIKE ${like})
    ORDER BY updated_at_ms DESC
    LIMIT ${bounds.limit + 1} OFFSET ${bounds.offset}
  `;
  const nullsStripped = rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).filter(([, value]) => value !== null),
    ),
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- null-stripping keeps the selected shape, minus absent optionals
  return pageOf(nullsStripped as ProjectLegRow[], bounds, args.list === true);
}

/** All ctx handlers for one turn. `sql` outlives the turn (the pool). */
export function chatShimHandlers(sql: Sql): ShimHandlers {
  return {
    ...knowledgeShimHandlers(sql),

    // ----------------------------------------------- governance (not ported)
    // Model access allows and context stays un-capped until the governance
    // domain lands; connector-usage metering no-ops the same way. Each of
    // these is a named row in MIGRATION.md, not a silent divergence.
    'governance/queries:checkModelAccessInternal': async () => ({
      allowed: true,
    }),
    'governance/queries:getContextCapInternal': async () => null,
    'governance/internal_mutations:recordConnectorUsage': async () => null,

    // -------------------------------------------------------------- lineage
    // Branches are not ported: every thread is its own lineage of one.
    'chat/branches:getThreadLineageIds': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as { organizationId: string; threadId: string };
      return { rootId: args.threadId, threadIds: [args.threadId] };
    },

    // -------------------------------------------------------------- history
    'chat/messages:listRecentForTurnInternal': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as {
        organizationId: string;
        threadId: string;
        maxChars: number;
        maxRows: number;
      };
      const rows = await sql<
        {
          id: string;
          role: string;
          parts: unknown;
          sequence: number;
          model: string | null;
          providerSlug: string | null;
          usage: unknown;
          blockedReason: string | null;
          error: string | null;
          createdAt: number;
        }[]
      >`
        SELECT m.id, m.role, m.parts, m."order" AS sequence,
               m.model, m.provider_slug AS "providerSlug", m.usage,
               m.blocked_reason AS "blockedReason", m.error,
               m.created_at_ms::float8 AS "createdAt"
        FROM app.messages m
        JOIN app.threads t ON t.id = m.thread_id
        WHERE m.thread_id = ${args.threadId}
          AND t.org_id = ${args.organizationId}
          AND m.status <> 'pending'
        ORDER BY m."order" DESC, m.step_order DESC
        LIMIT ${Math.max(1, Math.min(args.maxRows, 1000))}
      `;
      // Newest-first accumulation up to the char budget, returned oldest
      // first — the 0.4 walk, with the row cap already applied above.
      const recent: (typeof rows)[number][] = [];
      let chars = 0;
      for (const row of rows) {
        recent.push(row);
        chars += JSON.stringify(row.parts ?? []).length;
        if (chars >= args.maxChars) break;
      }
      recent.reverse();
      return {
        messages: recent.map((row) => ({
          id: row.id,
          role: row.role,
          parts: row.parts ?? [],
          sequence: row.sequence,
          model: row.model ?? undefined,
          providerSlug: row.providerSlug ?? undefined,
          usage: row.usage ?? undefined,
          blockedReason: row.blockedReason ?? undefined,
          error: row.error ?? undefined,
          createdAt: row.createdAt,
        })),
        omittedCount: recent[0]?.sequence ?? 0,
        // Thread skill loadouts are not ported yet.
        equippedSkills: [],
      };
    },

    // -------------------------------------------------------- file metadata
    'file_metadata/internal_queries:filterStorageIdsInOrg': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as { organizationId: string; storageIds: string[] };
      if (args.storageIds.length === 0) return [];
      const rows = await sql<{ storageRef: string }[]>`
        SELECT storage_ref AS "storageRef" FROM app.file_metadata
        WHERE org_id = ${args.organizationId}
          AND storage_ref = ANY(${args.storageIds})
          AND (lifecycle_status IS NULL OR lifecycle_status <> 'trashed')
      `;
      const owned = new Set(rows.map((row) => row.storageRef));
      return args.storageIds.filter((id) => owned.has(id));
    },

    'file_metadata/internal_queries:getByStorageId': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as { storageId: string };
      const rows = await sql<
        {
          id: string;
          organizationId: string;
          storageId: string;
          fileName: string;
          contentType: string;
          size: number;
          transcript: string | null;
          transcriptionStatus: string | null;
          transcriptionError: string | null;
          transcriptionDurationSec: number | null;
          ragStatus: string | null;
          threadId: string | null;
          documentId: string | null;
        }[]
      >`
        SELECT id, org_id AS "organizationId", storage_ref AS "storageId",
               file_name AS "fileName", content_type AS "contentType",
               size::float8 AS size, transcript,
               transcription_status AS "transcriptionStatus",
               transcription_error AS "transcriptionError",
               transcription_duration_sec AS "transcriptionDurationSec",
               rag_status AS "ragStatus", thread_id AS "threadId",
               document_id AS "documentId"
        FROM app.file_metadata
        WHERE storage_ref = ${args.storageId}
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      return Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, value ?? undefined]),
      );
    },

    'file_metadata/internal_mutations:bindStorageIdsToThread': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as {
        organizationId: string;
        threadId: string;
        storageIds: string[];
      };
      if (args.storageIds.length === 0) return null;
      await sql`
        UPDATE app.file_metadata SET thread_id = ${args.threadId}
        WHERE org_id = ${args.organizationId}
          AND storage_ref = ANY(${args.storageIds})
          AND thread_id IS NULL
      `;
      return null;
    },

    // Mail-ingest and video-link corpora have no 0.5 tables yet.
    'file_metadata/internal_queries:listMailAttachmentsForChat': async () => ({
      attachments: [],
      truncated: false,
    }),
    'file_metadata/internal_queries:lookupVideoLinkSources': async () => [],

    // ------------------------------------------------------------- projects
    'projects/internal_queries:getProjectIdForThread': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as { threadId: string };
      const rows = await sql<{ projectId: string | null }[]>`
        SELECT project_id AS "projectId" FROM app.thread_metadata
        WHERE thread_id = ${args.threadId}
        LIMIT 1
      `;
      return rows[0]?.projectId ?? null;
    },

    'projects/internal_queries:assertProjectAccessForChat': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as {
        projectId: string;
        organizationId: string;
        userId: string;
      };
      const scope = await resolveAccessScope(
        sql,
        args.organizationId,
        args.userId,
      );
      if (scope.projectIds.includes(args.projectId)) {
        return { allowed: true };
      }
      const exists = await sql<{ orgId: string }[]>`
        SELECT org_id AS "orgId" FROM app.projects
        WHERE id = ${args.projectId} LIMIT 1
      `;
      if (exists.length === 0) {
        return { allowed: false, reason: 'not_found' };
      }
      return {
        allowed: false,
        reason:
          exists[0]?.orgId === args.organizationId
            ? 'forbidden'
            : 'org_mismatch',
      };
    },

    'projects/internal_queries:getProjectForInjection': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as { projectId: string };
      const rows = await sql<
        Pick<ProjectRow, 'id' | 'name' | 'instructions' | 'knowledgeMode'>[]
      >`
        SELECT id, name, instructions, knowledge_mode AS "knowledgeMode"
        FROM app.projects WHERE id = ${args.projectId} LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      return {
        _id: row.id,
        name: row.name,
        instructions: row.instructions ?? undefined,
        knowledgeMode: row.knowledgeMode ?? undefined,
      };
    },

    'projects/internal_queries:getProjectLabelsForOrg': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as { organizationId: string; projectIds: string[] };
      if (args.projectIds.length === 0) return [];
      const rows = await sql<
        { id: string; name: string; key: string | null }[]
      >`
        SELECT id, name, key FROM app.projects
        WHERE org_id = ${args.organizationId} AND id = ANY(${args.projectIds})
      `;
      return rows.map((row) =>
        Object.assign(
          { id: row.id, name: row.name },
          row.key !== null ? { key: row.key } : {},
        ),
      );
    },

    // ------------------------------------------------------ knowledge scope
    'documents/internal_queries:resolveKnowledgeAccess': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as { organizationId: string; userId: string };
      const scope = await resolveAccessScope(
        sql,
        args.organizationId,
        args.userId,
      );
      return { ...scope, userId: args.userId };
    },

    'documents/internal_queries:listForAgent': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the chat tool passes exactly this subset
      const args = raw as {
        organizationId: string;
        userId: string;
        limit?: number;
        cursor?: number;
        projectId?: string;
      };
      const scope = await resolveAccessScope(
        sql,
        args.organizationId,
        args.userId,
      );
      const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
      const offset = Math.max(0, args.cursor ?? 0);
      const projectId =
        args.projectId !== undefined &&
        scope.projectIds.includes(args.projectId)
          ? args.projectId
          : null;
      const rows = await sql<
        {
          fileId: string;
          title: string | null;
          extension: string | null;
          folderPath: string | null;
          teamId: string | null;
          createdAt: number;
          sizeBytes: number | null;
        }[]
      >`
        SELECT d.file_ref AS "fileId", d.title, d.extension,
               coalesce(d.folder_path, f.path) AS "folderPath",
               d.team_id AS "teamId", d.created_at_ms::float8 AS "createdAt",
               (d.metadata ->> 'size')::float8 AS "sizeBytes"
        FROM app.documents d
        LEFT JOIN app.folders f ON f.id = d.folder_id
        WHERE d.org_id = ${args.organizationId}
          AND d.file_ref IS NOT NULL
          AND (d.lifecycle_status IS NULL OR d.lifecycle_status = 'active')
          AND (
            (${projectId}::text IS NOT NULL AND d.project_id = ${projectId})
            OR (${projectId}::text IS NULL AND d.project_id IS NULL AND (
              (d.team_id IS NULL AND cardinality(d.team_tags) = 0)
              OR d.team_id = ANY(${scope.teamIds})
              OR d.team_tags && ${scope.teamIds}
            ))
          )
        ORDER BY d.created_at_ms DESC, d.id
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      return {
        documents: page.map((row) => ({
          fileId: row.fileId,
          title: row.title ?? 'Untitled',
          extension: row.extension,
          folderPath: row.folderPath,
          teamId: row.teamId,
          createdAt: row.createdAt,
          sizeBytes: row.sizeBytes,
        })),
        totalCount: null,
        hasMore,
        cursor: hasMore ? offset + limit : null,
        warning: null,
      };
    },

    // ------------------------------------------------------- role gate
    // Tier-A matrix: an active member reads every chat-tool subject; the
    // disabled role reads nothing. The 0.4 per-subject role matrix ports
    // with governance.
    'sandbox/workspace_access:resolveWorkspaceReadAccess': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as { organizationId: string; userId: string };
      const member = await findOrganizationMember(
        sql,
        args.organizationId,
        args.userId,
      );
      return { allowed: member !== null && member.role !== 'disabled' };
    },

    // ------------------------------------------------------- observability
    'audit_logs/internal_mutations:createAuditLog': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes CreateAuditLogArgs verbatim
      const args = raw as Parameters<typeof createAuditLog>[1];
      await sql.begin((tx) => createAuditLog(tx, args));
      return null;
    },

    // ------------------------------------------------------- entity legs
    'tasks/search_for_chat:searchTasksForChat': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as Parameters<typeof searchTasks>[1];
      return searchTasks(sql, args);
    },

    'tasks/search_for_chat:searchProjectsForChat': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as Parameters<typeof searchProjects>[1];
      return searchProjects(sql, args);
    },

    'tasks/internal_queries:getTaskByIdInternal': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as { taskId: string; organizationId: string };
      const rows = await sql<TaskLegRow[]>`
        SELECT id AS "_id", title, description, status, priority,
               assignee_type AS "assigneeType", assignee_id AS "assigneeId",
               project_id AS "projectId", due_date_ms::float8 AS "dueDate",
               archived_at_ms::float8 AS "archivedAt"
        FROM app.tasks
        WHERE id = ${args.taskId} AND org_id = ${args.organizationId}
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      return Object.fromEntries(
        Object.entries(row).filter(([, value]) => value !== null),
      );
    },

    'tasks/internal_queries:getTaskContextForAgent': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as {
        taskId: string;
        organizationId: string;
        commentLimit?: number;
      };
      const tasks = await sql<
        (TaskLegRow & { discussionThreadId: string | null })[]
      >`
        SELECT id AS "_id", title, description, status, priority,
               project_id AS "projectId",
               discussion_thread_id AS "discussionThreadId"
        FROM app.tasks
        WHERE id = ${args.taskId} AND org_id = ${args.organizationId}
        LIMIT 1
      `;
      const task = tasks[0];
      if (!task) return null;
      const projects = await sql<
        { name: string; key: string | null; instructions: string | null }[]
      >`
        SELECT name, key, instructions FROM app.projects
        WHERE id = ${task.projectId ?? ''} LIMIT 1
      `;
      const project = projects[0];
      const subtasks = await sql<
        { title: string; status: string; assigneeId: string | null }[]
      >`
        SELECT title, status, assignee_id AS "assigneeId" FROM app.tasks
        WHERE parent_task_id = ${args.taskId} AND archived_at_ms IS NULL
        ORDER BY created_at_ms
        LIMIT 50
      `;
      const blockedBy = await sql<{ title: string; status: string }[]>`
        SELECT b.title, b.status
        FROM app.task_dependencies dep
        JOIN app.tasks b ON b.id = dep.blocker_task_id
        WHERE dep.blocked_task_id = ${args.taskId}
          AND b.archived_at_ms IS NULL
        LIMIT 25
      `;
      const commentLimit = Math.min(Math.max(args.commentLimit ?? 10, 1), 50);
      const comments = await sql<
        {
          authorType: string;
          authorId: string;
          body: string;
          createdAt: number;
        }[]
      >`
        SELECT * FROM (
          SELECT meta.author_type AS "authorType",
                 meta.author_id AS "authorId",
                 coalesce(m.text, '') AS body,
                 m.created_at_ms::float8 AS "createdAt"
          FROM app.task_discussion_message_meta meta
          JOIN app.messages m ON m.id = meta.message_id
          WHERE meta.task_id = ${args.taskId}
          ORDER BY m.created_at_ms DESC
          LIMIT ${commentLimit}
        ) recent ORDER BY "createdAt"
      `;
      return {
        task: {
          _id: task._id,
          title: task.title,
          status: task.status,
          ...(task.description != null
            ? { description: task.description }
            : {}),
          ...(task.projectId != null ? { projectId: task.projectId } : {}),
        },
        project: project
          ? {
              name: project.name,
              ...(project.key !== null ? { key: project.key } : {}),
              ...(project.instructions !== null
                ? { instructions: project.instructions }
                : {}),
            }
          : null,
        subtasks: subtasks.map((row) =>
          Object.assign(
            { title: row.title, status: row.status },
            row.assigneeId !== null ? { assigneeId: row.assigneeId } : {},
          ),
        ),
        blockedBy: [...blockedBy],
        comments: [...comments],
      };
    },

    'contacts/internal_queries:queryContacts': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the chat tool passes exactly this subset
      const args = raw as {
        organizationId: string;
        searchTerm?: string;
        paginationOpts?: PaginationOpts;
      };
      const bounds = pageBounds(args.paginationOpts);
      const term = args.searchTerm?.trim() ?? '';
      const like = `%${term}%`;
      const rows = await sql<
        {
          name: string | null;
          email: string | null;
          phone: string | null;
          tags: string[];
          lifecycleStatus: string | null;
        }[]
      >`
        SELECT name, email, phone, tags,
               lifecycle_status AS "lifecycleStatus"
        FROM app.contacts
        WHERE org_id = ${args.organizationId}
          AND (${term === ''} OR name ILIKE ${like} OR email ILIKE ${like}
               OR phone ILIKE ${like})
        ORDER BY updated_at_ms DESC
        LIMIT ${bounds.limit + 1} OFFSET ${bounds.offset}
      `;
      return pageOf(
        rows.map((row) =>
          Object.assign(
            { tags: row.tags },
            row.name !== null ? { name: row.name } : {},
            row.email !== null ? { email: row.email } : {},
            row.phone !== null ? { phone: row.phone } : {},
            row.lifecycleStatus !== null
              ? { lifecycleStatus: row.lifecycleStatus }
              : {},
          ),
        ),
        bounds,
      );
    },

    'products/internal_queries:queryProducts': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the chat tool passes exactly this subset
      const args = raw as {
        organizationId: string;
        searchTerm?: string;
        paginationOpts?: PaginationOpts;
      };
      const bounds = pageBounds(args.paginationOpts);
      const term = args.searchTerm?.trim() ?? '';
      const like = `%${term}%`;
      const rows = await sql<
        {
          name: string;
          category: string | null;
          price: number | null;
          stock: number | null;
          status: string | null;
        }[]
      >`
        SELECT name, category, price, stock, status
        FROM app.products
        WHERE org_id = ${args.organizationId}
          AND (${term === ''} OR name ILIKE ${like} OR category ILIKE ${like}
               OR description ILIKE ${like})
        ORDER BY updated_at_ms DESC
        LIMIT ${bounds.limit + 1} OFFSET ${bounds.offset}
      `;
      return pageOf(
        rows.map((row) =>
          Object.assign(
            { name: row.name },
            row.category !== null ? { category: row.category } : {},
            row.price !== null ? { price: row.price } : {},
            row.stock !== null ? { stock: row.stock } : {},
            row.status !== null ? { status: row.status } : {},
          ),
        ),
        bounds,
      );
    },

    // Corpora without 0.5 tables yet — honest empties (see module header).
    'knowledge_entries/internal_queries:listEntriesForAgent': async () =>
      emptyPage(),
    'websites/internal_queries:listWebsiteSummaries': async () => [],
    'conversations/search_for_chat:searchConversationsForChat': async () => ({
      conversations: [],
      truncated: false,
    }),
  };
}
