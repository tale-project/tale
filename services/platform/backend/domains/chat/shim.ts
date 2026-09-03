import type { Sql } from 'postgres';

import { findOrganizationMember } from '../../auth/membership.ts';
import type { ShimHandlers } from '../../lib/ctx-shim.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { searchConversationsForChat } from '../conversations/search-chat.ts';
import { listDocumentsForAgent } from '../documents/agent-list.ts';
import {
  resolveFileReadAccess,
  viewerForUser,
  type FileBindingFields,
} from '../files/access.ts';
import {
  checkModelAccessForUser,
  resolveModelGovernanceForUser,
  getContextCapForUser,
  recordConnectorUsage,
} from '../governance/service.ts';
import { knowledgeShimHandlers } from '../knowledge/service.ts';
import { listEntriesForAgent } from '../knowledge_entries/service.ts';
import {
  getProjectAuthContext,
  listProjects,
  type ProjectRow,
} from '../projects/service.ts';
import { listServingCredentialFacts } from '../provider_credentials/service.ts';
import { getThreadLineageIds, setThreadTitleIfAbsent } from './threads.ts';

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
 *  - honest empties for corpora 0.5 has no tables for yet (websites,
 *    video links) — an empty result is factually right against this
 *    database, and the tool layer already words empties for the model.
 *
 * Everything stays fail-loud for names NOT in this map — a new ctx call in
 * 0.4 surfaces as `[ctx-shim] un-shimmed …` naming the function.
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

    // ------------------------------------------------ governance (enforced)
    // The REAL policy verdicts over the org's governance files — the same
    // pure evaluators 0.4 runs, hosted on the 0.5 policy reader.
    'user_preferences/queries:getChatModelInternal': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as { userId: string; organizationId: string };
      const rows = await sql<{ chatModelId: string | null }[]>`
        SELECT chat_model_id AS "chatModelId" FROM app.user_preferences
        WHERE user_id = ${args.userId} AND org_id = ${args.organizationId}
        LIMIT 1
      `;
      return rows[0]?.chatModelId ?? null;
    },

    'chat/threads:setThreadTitleInternal': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as {
        organizationId: string;
        threadId: string;
        title: string;
      };
      await setThreadTitleIfAbsent(
        sql,
        args.organizationId,
        args.threadId,
        args.title,
      );
      return null;
    },

    // The Auto pick's credential world — the SAME servable set the composer
    // lists (each provider's active default), so Auto can never pick a model
    // the picker stopped offering, nor one no turn could serve.
    'provider_credentials/queries:listActiveCredentialFactsInternal': async (
      raw,
    ) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as { organizationId: string };
      return listServingCredentialFacts(sql, args.organizationId);
    },

    'governance/internal_queries:resolveModelGovernanceInternal': async (
      raw,
    ) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as {
        organizationId: string;
        userId: string;
        supportedModels: string[];
        explicitModelId?: string;
      };
      return resolveModelGovernanceForUser(sql, args);
    },

    'governance/queries:checkModelAccessInternal': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as {
        organizationId: string;
        userId: string;
        modelId: string;
      };
      return checkModelAccessForUser(sql, args);
    },
    'governance/queries:getContextCapInternal': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as { organizationId: string; userId: string };
      return getContextCapForUser(sql, args);
    },
    'governance/internal_mutations:recordConnectorUsage': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as Parameters<typeof recordConnectorUsage>[1];
      await recordConnectorUsage(sql, args);
      return null;
    },

    // -------------------------------------------------------------- lineage
    'chat/branches:getThreadLineageIds': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as { organizationId: string; threadId: string };
      return getThreadLineageIds(sql, args.organizationId, args.threadId);
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
    // The attachments a sender may put in front of the model: rows of this
    // org, not trashed, AND readable by the sender through the files read
    // gate (their own uploads, or a document/thread/conversation/task they
    // can read). A bare ref — every document reader holds one — admits
    // nothing: the model would otherwise read it out to the sender.
    'file_metadata/internal_queries:filterStorageIdsReadable': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as {
        organizationId: string;
        userId: string;
        storageIds: string[];
      };
      if (args.storageIds.length === 0) return [];
      const viewer = await viewerForUser(sql, args.organizationId, args.userId);
      if (viewer === null) return [];
      const rows = await sql<FileBindingFields[]>`
        SELECT org_id AS "organizationId", storage_ref AS "storageRef",
               uploaded_by AS "uploadedBy", document_id AS "documentId",
               thread_id AS "threadId", conversation_id AS "conversationId"
        FROM app.file_metadata
        WHERE org_id = ${args.organizationId}
          AND storage_ref = ANY(${args.storageIds})
          AND (lifecycle_status IS NULL OR lifecycle_status <> 'trashed')
      `;
      const readable = new Set<string>();
      for (const row of rows) {
        if (readable.has(row.storageRef)) continue;
        if (await resolveFileReadAccess(sql, viewer, row)) {
          readable.add(row.storageRef);
        }
      }
      return args.storageIds.filter((id) => readable.has(id));
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

    // Bind the sender's OWN still-unbound staging uploads to the thread they
    // were sent in. Never a row someone else uploaded, never a document's
    // row: binding is a read grant to the thread's audience, so it may only
    // widen what the sender already owns outright.
    'file_metadata/internal_mutations:bindStorageIdsToThread': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as {
        organizationId: string;
        userId: string;
        threadId: string;
        storageIds: string[];
      };
      if (args.storageIds.length === 0) return null;
      await sql`
        UPDATE app.file_metadata SET thread_id = ${args.threadId}
        WHERE org_id = ${args.organizationId}
          AND storage_ref = ANY(${args.storageIds})
          AND uploaded_by = ${args.userId}
          AND document_id IS NULL
          AND thread_id IS NULL
      `;
      return null;
    },

    // Mail-ingest and video-link corpora have no 0.5 tables yet.
    'file_metadata/internal_queries:listMailAttachmentsForChat': async () => ({
      attachments: [],
      truncated: false,
    }),
    'file_metadata/internal_queries:lookupVideoLinkSources': async (raw) => {
      // Inline SQL (not the video_links service) — that service composes
      // ON TOP of this shim, so an import here would be a cycle.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 caller passes exactly this shape
      const args = raw as { storageIds: string[] };
      if (args.storageIds.length === 0) return [];
      return sql<
        { storageId: string; sourceUrl: string; sourcePlatform: string }[]
      >`
        SELECT storage_ref AS "storageId", source_url AS "sourceUrl",
               source_platform AS "sourcePlatform"
        FROM app.video_link_jobs
        WHERE storage_ref = ANY(${args.storageIds})
      `;
    },

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
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the chat tool and the sandbox user door pass exactly this subset
      const args = raw as {
        organizationId: string;
        userId: string;
        limit?: number;
        cursor?: number;
        projectId?: string;
        fileName?: string;
        extension?: string;
      };
      const scope = await resolveAccessScope(
        sql,
        args.organizationId,
        args.userId,
      );
      // An unreadable/absent project falls through to hub rules (the 0.4
      // fail-safe) — never a boundary loosening.
      return listDocumentsForAgent(sql, {
        organizationId: args.organizationId,
        teamIds: scope.teamIds,
        ...(args.projectId !== undefined &&
        scope.projectIds.includes(args.projectId)
          ? { projectId: args.projectId }
          : {}),
        ...(args.fileName !== undefined ? { fileName: args.fileName } : {}),
        ...(args.extension !== undefined ? { extension: args.extension } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
        ...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
      });
    },

    // Both read doors (the chat rag_fetch fallback and the sandbox bridge)
    // consult this row for scope AND for inline `content` — hub-authored
    // documents carry their text on the row, not in the corpus.
    'documents/internal_queries:findDocumentByFileId': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: both read doors pass exactly this shape
      const args = raw as { organizationId: string; fileId: string };
      const rows = await sql<
        {
          id: string;
          title: string | null;
          content: string | null;
          fileId: string;
          projectId: string | null;
          teamId: string | null;
          teamTags: string[];
          folderPath: string | null;
          lifecycleStatus: string | null;
          createdAt: number;
        }[]
      >`
        SELECT id, title, content, file_ref AS "fileId",
               project_id AS "projectId",
               team_id AS "teamId", team_tags AS "teamTags",
               folder_path AS "folderPath",
               lifecycle_status AS "lifecycleStatus",
               created_at_ms::float8 AS "createdAt"
        FROM app.documents
        WHERE org_id = ${args.organizationId} AND file_ref = ${args.fileId}
        LIMIT 1
      `;
      return rows[0] ?? null;
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

    'knowledge_entries/internal_queries:listEntriesForAgent': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 tool leg passes exactly this shape
      const args = raw as {
        organizationId: string;
        topic?: string;
        paginationOpts: { numItems: number; cursor: string | null };
      };
      return listEntriesForAgent(sql, {
        organizationId: args.organizationId,
        ...(args.topic !== undefined ? { topic: args.topic } : {}),
        numItems: args.paginationOpts.numItems,
        cursor: args.paginationOpts.cursor,
      });
    },
    // A corpus without a 0.5 table yet — an honest empty (see header).
    'websites/internal_queries:listWebsiteSummaries': async () => [],
    'conversations/search_for_chat:searchConversationsForChat': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the 0.4 tool leg passes exactly this shape
      const args = raw as Parameters<typeof searchConversationsForChat>[1];
      return searchConversationsForChat(sql, args);
    },
  };
}
