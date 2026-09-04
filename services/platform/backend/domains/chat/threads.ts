import { randomBytes } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import {
  getUserTeamIds,
  findOrganizationMember,
} from '../../auth/membership.ts';
import { checkProjectAccess } from '../../core/projects/access.ts';
import { toJson } from '../../db/sql.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { assertNotHeld, loadActiveHolds } from '../legal_holds/service.ts';

/**
 * Threads — the conversations a user owns in one organization; the 0.5 twin
 * of `convex/chat/threads.ts` + `thread_lifecycle.ts` + `project_threads.ts`
 * + `search.ts` over `app.threads` + the `app.thread_metadata` sidecar.
 *
 * Every read and write scopes by BOTH the organization and the caller: a
 * thread is user-private. Sharing is the one deliberate crack in that wall —
 * opt-in, org-internal, snapshotted at `sharedAt` — plus the project-shared
 * read grant. Branching forks a NEW thread (the original is never
 * rewritten); trash is a lifecycle status the normal reads treat as gone.
 *
 * Deferred with their own domains: legal holds on trash/restore (the
 * retention/holds port) and the trash purge sweep (the retention sweep owns
 * re-invoking the page-bounded purge).
 */

export class ChatThreadError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;
  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'ChatThreadError';
    this.code = code;
    this.status = status;
  }
}

export interface ThreadCapabilities {
  skills: string[];
  connectors: string[];
}

/** One row of the thread list, already reduced to what the panel renders. */
export interface ThreadSummary {
  id: string;
  title: string | null;
  kind: string;
  agentSlug: string | null;
  harness: string | null;
  capabilities: ThreadCapabilities | null;
  reasoningEffort: string | null;
  projectId: string | null;
  sharedWithProject: boolean | null;
  archived: boolean;
  pinnedAt: number | null;
  lastReplyAt: number | null;
  lastReadAt: number | null;
  isShared: boolean | null;
  createdAt: number;
  updatedAt: number;
  generating: boolean;
  viewerIsOwner: boolean;
}

interface ThreadRow {
  id: string;
  organizationId: string;
  userId: string;
  title: string | null;
  kind: string;
  agentSlug: string | null;
  harness: string | null;
  capabilities: unknown;
  reasoningEffort: string | null;
  projectId: string | null;
  sharedWithProject: boolean | null;
  archived: boolean;
  pinnedAt: number | null;
  lastReplyAt: number | null;
  lastReadAt: number | null;
  isShared: boolean | null;
  shareToken: string | null;
  sharedAt: number | null;
  sharedBy: string | null;
  status: string;
  branchRootId: string | null;
  hidden: boolean | null;
  createdAt: number;
  updatedAt: number;
}

const THREAD_COLUMNS = `
  t.id, t.org_id AS "organizationId", t.user_id AS "userId", t.title,
  tm.chat_type AS "kind", tm.agent_slug AS "agentSlug", tm.harness,
  tm.capabilities, tm.reasoning_effort AS "reasoningEffort",
  tm.project_id AS "projectId",
  tm.shared_with_project AS "sharedWithProject", tm.archived,
  tm.pinned_at_ms::float8 AS "pinnedAt",
  tm.last_reply_at_ms::float8 AS "lastReplyAt",
  tm.last_read_at_ms::float8 AS "lastReadAt",
  tm.is_shared AS "isShared", tm.share_token AS "shareToken",
  tm.shared_at_ms::float8 AS "sharedAt", tm.shared_by AS "sharedBy",
  tm.status, tm.branch_root_id AS "branchRootId", tm.hidden,
  t.created_at_ms::float8 AS "createdAt", t.updated_at_ms::float8 AS "updatedAt"
`;

function readCapabilities(value: unknown): ThreadCapabilities | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as { skills?: unknown; connectors?: unknown };
  const strings = (list: unknown): string[] =>
    Array.isArray(list)
      ? list.filter((entry): entry is string => typeof entry === 'string')
      : [];
  return {
    skills: strings(record.skills),
    connectors: strings(record.connectors),
  };
}

function toSummary(
  row: ThreadRow,
  generating: boolean,
  viewerIsOwner = true,
): ThreadSummary {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    agentSlug: row.agentSlug,
    harness: row.harness,
    capabilities: readCapabilities(row.capabilities),
    reasoningEffort: row.reasoningEffort,
    projectId: row.projectId,
    sharedWithProject: row.sharedWithProject,
    archived: row.archived,
    pinnedAt: row.pinnedAt,
    lastReplyAt: row.lastReplyAt,
    lastReadAt: row.lastReadAt,
    isShared: row.isShared,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    generating,
    viewerIsOwner,
  };
}

/** A conversation may equip its agent with at most this many skills /
 * connectors — mirrors the project binding's ceilings. */
const MAX_THREAD_SKILLS = 25;
const MAX_THREAD_CONNECTORS = 25;

/** Normalize a capability assembly for storage: enforce the ceilings,
 * dedupe, drop empties; an all-empty assembly collapses to null so the
 * thread falls back to its defaults rather than pinning "nothing". */
export function sanitizeThreadCapabilities(
  capabilities: ThreadCapabilities,
): ThreadCapabilities | null {
  if (
    capabilities.skills.length > MAX_THREAD_SKILLS ||
    capabilities.connectors.length > MAX_THREAD_CONNECTORS
  ) {
    throw new ChatThreadError(
      'too_many_bindings',
      `A conversation may equip at most ${MAX_THREAD_SKILLS} skills and ${MAX_THREAD_CONNECTORS} connectors.`,
    );
  }
  const skills = [
    ...new Set(capabilities.skills.filter((slug) => slug.length > 0)),
  ];
  const connectors = [
    ...new Set(capabilities.connectors.filter((slug) => slug.length > 0)),
  ];
  if (skills.length === 0 && connectors.length === 0) return null;
  return { skills, connectors };
}

/** 256 bits of randomness, hex encoded — the whole credential of the share
 * URL (the 0.4 entropy budget). */
function mintShareToken(): string {
  return randomBytes(32).toString('hex');
}

/** Can this member read the project? The chat↔project gate every touchpoint
 * uses ('ok' | 'not_found' | 'forbidden'). */
export async function projectChatAccess(
  sql: Sql | TransactionSql,
  args: { projectId: string; organizationId: string; userId: string },
): Promise<'ok' | 'not_found' | 'forbidden'> {
  const projects = await sql<
    { orgId: string; teamId: string | null; sharedWithTeamIds: string[] }[]
  >`
    SELECT org_id AS "orgId", team_id AS "teamId",
           shared_with_team_ids AS "sharedWithTeamIds"
    FROM app.projects WHERE id = ${args.projectId} LIMIT 1
  `;
  const project = projects[0];
  if (!project || project.orgId !== args.organizationId) return 'not_found';
  const member = await findOrganizationMember(
    sql,
    args.organizationId,
    args.userId,
  );
  if (member === null || member.role === 'disabled') return 'forbidden';
  const teamIds = await getUserTeamIds(sql, args.userId);
  const access = checkProjectAccess(
    { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
    teamIds,
    member.role,
  );
  return access.canRead ? 'ok' : 'forbidden';
}

/** Load a thread the caller OWNS — null when it does not exist, is someone
 * else's, or sits in the trash (indistinguishable by design). */
export async function loadOwnedThread(
  sql: Sql | TransactionSql,
  organizationId: string,
  userId: string,
  threadId: string,
): Promise<ThreadRow | null> {
  const rows = await sql<ThreadRow[]>`
    SELECT ${sql.unsafe(THREAD_COLUMNS)}
    FROM app.threads t
    JOIN app.thread_metadata tm ON tm.thread_id = t.id
    WHERE t.id = ${threadId} AND t.org_id = ${organizationId}
      AND t.user_id = ${userId} AND tm.status = 'active'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** The one read-grant beside share links: a project member may READ a
 * conversation its owner shared with the project. Never for writes. */
export async function loadProjectSharedThread(
  sql: Sql,
  organizationId: string,
  userId: string,
  threadId: string,
): Promise<ThreadRow | null> {
  const rows = await sql<ThreadRow[]>`
    SELECT ${sql.unsafe(THREAD_COLUMNS)}
    FROM app.threads t
    JOIN app.thread_metadata tm ON tm.thread_id = t.id
    WHERE t.id = ${threadId} AND t.org_id = ${organizationId}
      AND tm.status = 'active' AND tm.shared_with_project = true
      AND tm.project_id IS NOT NULL
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || row.projectId === null) return null;
  const access = await projectChatAccess(sql, {
    projectId: row.projectId,
    organizationId,
    userId,
  });
  return access === 'ok' ? row : null;
}

/** The generating thread ids of one org (a generation row exists exactly
 * while a turn is in flight). */
async function generatingThreadIds(
  sql: Sql,
  organizationId: string,
): Promise<Set<string>> {
  const rows = await sql<{ threadId: string }[]>`
    SELECT thread_id AS "threadId" FROM app.generations
    WHERE org_id = ${organizationId}
  `;
  return new Set(rows.map((row) => row.threadId));
}

/**
 * The caller's ACTIVE threads — live, visible (not a hidden branch sibling),
 * unarchived — newest activity first with pinned rows floated on top.
 * Deliberately unpaginated like 0.4: the panel buckets the full set, and the
 * walk pre-filters to the bounded active set.
 */
export async function listThreads(
  sql: Sql,
  organizationId: string,
  userId: string,
): Promise<ThreadSummary[]> {
  const rows = await sql<ThreadRow[]>`
    SELECT ${sql.unsafe(THREAD_COLUMNS)}
    FROM app.threads t
    JOIN app.thread_metadata tm ON tm.thread_id = t.id
    WHERE t.org_id = ${organizationId} AND t.user_id = ${userId}
      AND tm.status = 'active' AND tm.archived = false
      AND tm.hidden IS NOT true
    ORDER BY t.updated_at_ms DESC
  `;
  const generating = await generatingThreadIds(sql, organizationId);
  const pinned = rows
    .filter((row) => row.pinnedAt !== null)
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
  const unpinned = rows.filter((row) => row.pinnedAt === null);
  return [...pinned, ...unpinned].map((row) =>
    toSummary(row, generating.has(row.id)),
  );
}

const ARCHIVED_PAGE_DEFAULT = 30;
const ARCHIVED_PAGE_MAX = 50;

/** The caller's archived threads, newest first, one keyset page at a time
 * (`cursor` = the previous page's last `updatedAt`). */
export async function listArchivedThreads(
  sql: Sql,
  organizationId: string,
  userId: string,
  options: { cursor?: number; limit?: number } = {},
): Promise<{ rows: ThreadSummary[]; nextCursor: number | null }> {
  const limit = Math.min(
    Math.max(options.limit ?? ARCHIVED_PAGE_DEFAULT, 1),
    ARCHIVED_PAGE_MAX,
  );
  const cursor = options.cursor;
  const page = await sql<ThreadRow[]>`
    SELECT ${sql.unsafe(THREAD_COLUMNS)}
    FROM app.threads t
    JOIN app.thread_metadata tm ON tm.thread_id = t.id
    WHERE t.org_id = ${organizationId} AND t.user_id = ${userId}
      AND tm.status = 'active' AND tm.archived = true
      AND tm.hidden IS NOT true
      AND (${cursor ?? null}::bigint IS NULL
           OR t.updated_at_ms < ${cursor ?? null})
    ORDER BY t.updated_at_ms DESC
    LIMIT ${limit + 1}
  `;
  const rows = page.slice(0, limit);
  const nextCursor =
    page.length > limit ? (rows.at(-1)?.updatedAt ?? null) : null;
  // Nothing archived generates — a turn cannot be sent into an archived
  // thread — so the flag is constant false rather than a scan.
  return { rows: rows.map((row) => toSummary(row, false)), nextCursor };
}

/** One thread: the caller's own, or — read-only — a project-shared one. */
export async function getThread(
  sql: Sql,
  organizationId: string,
  userId: string,
  threadId: string,
): Promise<ThreadSummary | null> {
  const owned = await loadOwnedThread(sql, organizationId, userId, threadId);
  const row =
    owned ??
    (await loadProjectSharedThread(sql, organizationId, userId, threadId));
  if (!row) return null;
  const generating = await sql<{ threadId: string }[]>`
    SELECT thread_id AS "threadId" FROM app.generations
    WHERE thread_id = ${row.id} LIMIT 1
  `;
  return toSummary(row, generating.length > 0, owned !== null);
}

export interface CreateThreadArgs {
  organizationId: string;
  userId: string;
  kind: string;
  title?: string;
  agentSlug?: string;
  harness?: string;
  capabilities?: ThreadCapabilities;
  projectId?: string;
  reasoningEffort?: string;
}

/** Create a thread; a project link is access-checked with the same gate the
 * send path uses — a thread must never smuggle a caller into a project they
 * cannot read. */
export async function createThread(
  sql: Sql,
  args: CreateThreadArgs,
): Promise<string> {
  if (args.projectId !== undefined) {
    const access = await projectChatAccess(sql, {
      projectId: args.projectId,
      organizationId: args.organizationId,
      userId: args.userId,
    });
    if (access !== 'ok') {
      throw new ChatThreadError(
        access === 'not_found' ? 'PROJECT_NOT_FOUND' : 'PROJECT_FORBIDDEN',
        'Project unavailable',
        access === 'not_found' ? 404 : 403,
      );
    }
  }
  const capabilities =
    args.capabilities !== undefined
      ? sanitizeThreadCapabilities(args.capabilities)
      : null;
  const now = Date.now();
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      INSERT INTO app.threads (org_id, user_id, title, kind, created_at_ms,
                               updated_at_ms)
      VALUES (${args.organizationId}, ${args.userId}, ${args.title ?? null},
              ${args.kind}, ${now}, ${now})
      RETURNING id
    `;
    const id = rows[0]?.id;
    if (!id) throw new Error('thread insert failed');
    await tx`
      INSERT INTO app.thread_metadata (
        thread_id, org_id, user_id, chat_type, status, project_id,
        agent_slug, harness, capabilities, reasoning_effort, created_at_ms
      ) VALUES (
        ${id}, ${args.organizationId}, ${args.userId}, ${args.kind},
        'active', ${args.projectId ?? null}, ${args.agentSlug ?? null},
        ${args.harness ?? null},
        ${capabilities === null ? null : tx.json(toJson(capabilities))},
        ${args.reasoningEffort ?? null}, ${now}
      )
    `;
    return id;
  });
}

/** Replace the conversation's capability assembly for the turns that follow.
 * A metadata edit — `updatedAt` stays untouched. */
export async function setThreadCapabilities(
  sql: Sql,
  organizationId: string,
  userId: string,
  threadId: string,
  capabilities: ThreadCapabilities,
): Promise<boolean> {
  const thread = await loadOwnedThread(sql, organizationId, userId, threadId);
  if (!thread) return false;
  const sanitized = sanitizeThreadCapabilities(capabilities);
  await sql`
    UPDATE app.thread_metadata SET
      capabilities = ${sanitized === null ? null : sql.json(toJson(sanitized))}
    WHERE thread_id = ${thread.id}
  `;
  return true;
}

/** Remember the conversation's reasoning-effort pick; absent clears it. */
export async function setThreadReasoningEffort(
  sql: Sql,
  organizationId: string,
  userId: string,
  threadId: string,
  reasoningEffort: string | undefined,
): Promise<boolean> {
  const thread = await loadOwnedThread(sql, organizationId, userId, threadId);
  if (!thread) return false;
  await sql`
    UPDATE app.thread_metadata SET
      reasoning_effort = ${reasoningEffort ?? null}
    WHERE thread_id = ${thread.id}
  `;
  return true;
}

/**
 * File a thread under a project, or take it back out (null). Changing the
 * project ENDS a project share: the owner's opt-in named one specific
 * audience, and carrying the flag into another project would hand its
 * members the whole history with no consent and no audit row. The implicit
 * unshare is audited on the project the thread leaves — the owner re-shares
 * in the new project deliberately.
 */
export async function moveThreadToProject(
  sql: Sql,
  auth: { organizationId: string; userId: string; email?: string },
  threadId: string,
  projectId: string | null,
): Promise<boolean> {
  const thread = await loadOwnedThread(
    sql,
    auth.organizationId,
    auth.userId,
    threadId,
  );
  if (!thread) return false;
  if (projectId !== null) {
    const access = await projectChatAccess(sql, {
      projectId,
      organizationId: auth.organizationId,
      userId: auth.userId,
    });
    if (access !== 'ok') {
      throw new ChatThreadError(
        access === 'not_found' ? 'PROJECT_NOT_FOUND' : 'PROJECT_FORBIDDEN',
        'Project unavailable',
        access === 'not_found' ? 404 : 403,
      );
    }
  }
  const previousProjectId = thread.projectId;
  const moved = projectId !== previousProjectId;
  const endsShare =
    moved && thread.sharedWithProject === true && previousProjectId !== null;
  await sql.begin(async (tx) => {
    await tx`
      UPDATE app.thread_metadata SET
        project_id = ${projectId},
        shared_with_project = ${moved ? false : thread.sharedWithProject}
      WHERE thread_id = ${thread.id}
    `;
    if (!endsShare) return;
    const projects = await tx<{ name: string }[]>`
      SELECT name FROM app.projects WHERE id = ${previousProjectId} LIMIT 1
    `;
    await createAuditLog(tx, {
      organizationId: auth.organizationId,
      actorId: auth.userId,
      ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
      actorType: 'user',
      action: 'project.thread.unshared',
      category: 'data',
      resourceType: 'project',
      resourceId: previousProjectId,
      ...(projects[0] ? { resourceName: projects[0].name } : {}),
      status: 'success',
      previousState: { threadId: thread.id, shared: true },
      newState: {
        threadId: thread.id,
        shared: false,
        movedToProjectId: projectId,
      },
    });
  });
  return true;
}

/** The header cap on a chat name — mirrors the AI title generator's own. */
export const MAX_THREAD_TITLE_CHARS = 120;

/** Rename a thread; the owner's explicit name always wins. */
export async function renameThread(
  sql: Sql,
  organizationId: string,
  userId: string,
  threadId: string,
  title: string,
): Promise<boolean> {
  const thread = await loadOwnedThread(sql, organizationId, userId, threadId);
  if (!thread) return false;
  const trimmed = title.trim().slice(0, MAX_THREAD_TITLE_CHARS);
  if (trimmed.length === 0) return false;
  await sql`
    UPDATE app.threads SET title = ${trimmed} WHERE id = ${thread.id}
  `;
  return true;
}

/** Fill an ABSENT title only — the AI-title write; a rename or an explicit
 * birth title is never clobbered (the 0.4 `setThreadTitleInternal` guard). */
export async function setThreadTitleIfAbsent(
  sql: Sql,
  organizationId: string,
  threadId: string,
  title: string,
): Promise<void> {
  const trimmed = title.trim().slice(0, MAX_THREAD_TITLE_CHARS);
  if (trimmed.length === 0) return;
  await sql`
    UPDATE app.threads SET title = ${trimmed}
    WHERE id = ${threadId} AND org_id = ${organizationId} AND title IS NULL
  `;
}

/** Pin or unpin — pinned rows float to the top, newest pin first. */
export async function setThreadPinned(
  sql: Sql,
  organizationId: string,
  userId: string,
  threadId: string,
  pinned: boolean,
): Promise<boolean> {
  const thread = await loadOwnedThread(sql, organizationId, userId, threadId);
  if (!thread) return false;
  await sql`
    UPDATE app.thread_metadata SET
      pinned_at_ms = ${pinned ? Date.now() : null}
    WHERE thread_id = ${thread.id}
  `;
  return true;
}

/** Move the owner's read watermark — forward, or back to unread. Best-effort
 * by design: a missing or foreign row is a silent no-op. */
export async function markThreadRead(
  sql: Sql,
  organizationId: string,
  userId: string,
  threadId: string,
  read: boolean,
): Promise<void> {
  const thread = await loadOwnedThread(sql, organizationId, userId, threadId);
  if (!thread) return;
  if (!read) {
    await sql`
      UPDATE app.thread_metadata SET
        last_read_at_ms = NULL,
        last_reply_at_ms = coalesce(last_reply_at_ms, ${thread.updatedAt})
      WHERE thread_id = ${thread.id}
    `;
    return;
  }
  await sql`
    UPDATE app.thread_metadata SET last_read_at_ms = ${Date.now()}
    WHERE thread_id = ${thread.id}
  `;
}

/** Archive or unarchive. A metadata edit (recency preserved); audited. */
export async function setThreadArchived(
  sql: Sql,
  auth: { organizationId: string; userId: string; email?: string },
  threadId: string,
  archived: boolean,
): Promise<boolean> {
  const thread = await loadOwnedThread(
    sql,
    auth.organizationId,
    auth.userId,
    threadId,
  );
  if (!thread) return false;
  if (thread.archived === archived) return true;
  await sql.begin(async (tx) => {
    await tx`
      UPDATE app.thread_metadata SET archived = ${archived}
      WHERE thread_id = ${thread.id}
    `;
    await createAuditLog(tx, {
      organizationId: auth.organizationId,
      actorId: auth.userId,
      ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
      actorType: 'user',
      action: archived ? 'chat_thread.archived' : 'chat_thread.unarchived',
      category: 'data',
      resourceType: 'thread',
      resourceId: thread.id,
      ...(thread.title !== null ? { resourceName: thread.title } : {}),
      status: 'success',
    });
  });
  return true;
}

/** The owner's opt-in to make the conversation readable by everyone with
 * access to its project. Audited on the project. */
export async function setThreadSharedWithProject(
  sql: Sql,
  auth: { organizationId: string; userId: string; email?: string },
  threadId: string,
  shared: boolean,
): Promise<boolean> {
  const thread = await loadOwnedThread(
    sql,
    auth.organizationId,
    auth.userId,
    threadId,
  );
  if (!thread) return false;
  if (thread.projectId === null) {
    throw new ChatThreadError(
      'THREAD_NOT_IN_PROJECT',
      'File the conversation in a project first',
    );
  }
  await sql.begin(async (tx) => {
    await tx`
      UPDATE app.thread_metadata SET shared_with_project = ${shared}
      WHERE thread_id = ${thread.id}
    `;
    const projects = await tx<{ name: string }[]>`
      SELECT name FROM app.projects WHERE id = ${thread.projectId} LIMIT 1
    `;
    if (projects[0]) {
      await createAuditLog(tx, {
        organizationId: auth.organizationId,
        actorId: auth.userId,
        ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
        actorType: 'user',
        action: shared ? 'project.thread.shared' : 'project.thread.unshared',
        category: 'data',
        resourceType: 'project',
        resourceId: thread.projectId ?? '',
        resourceName: projects[0].name,
        status: 'success',
        newState: { threadId: thread.id, shared },
      });
    }
  });
  return true;
}

/** Share org-internally: mint (or keep) the token and stamp `sharedAt` — the
 * snapshot boundary. Re-sharing refreshes the boundary, keeping the URL. */
export async function shareThread(
  sql: Sql,
  organizationId: string,
  userId: string,
  threadId: string,
): Promise<{ shareToken: string } | null> {
  const thread = await loadOwnedThread(sql, organizationId, userId, threadId);
  if (!thread) return null;
  const shareToken = thread.shareToken ?? mintShareToken();
  await sql`
    UPDATE app.thread_metadata SET
      share_token = ${shareToken}, is_shared = true,
      shared_at_ms = ${Date.now()}, shared_by = ${userId}
    WHERE thread_id = ${thread.id}
  `;
  return { shareToken };
}

/**
 * Stop sharing; the token is kept so re-sharing restores the same URL.
 * Owner-matched on the row itself rather than through the active-thread
 * read: a conversation already in the trash must stay revocable — the link's
 * gate hides it meanwhile, but a restore would otherwise bring the share
 * back without the owner ever having been able to switch it off. Returns
 * whether an owned row was matched, so the route answers honestly.
 */
export async function unshareThread(
  sql: Sql,
  organizationId: string,
  userId: string,
  threadId: string,
): Promise<boolean> {
  const rows = await sql<{ threadId: string }[]>`
    UPDATE app.thread_metadata tm SET is_shared = false
    FROM app.threads t
    WHERE tm.thread_id = t.id AND t.id = ${threadId}
      AND t.org_id = ${organizationId} AND t.user_id = ${userId}
    RETURNING tm.thread_id AS "threadId"
  `;
  return rows.length > 0;
}

export async function getThreadShareStatus(
  sql: Sql,
  organizationId: string,
  userId: string,
  threadId: string,
): Promise<{
  isShared: boolean;
  shareToken: string | null;
  sharedAt: number | null;
  isShareable: boolean;
} | null> {
  const thread = await loadOwnedThread(sql, organizationId, userId, threadId);
  if (!thread) return null;
  return {
    isShared: thread.isShared === true,
    shareToken: thread.shareToken,
    sharedAt: thread.sharedAt,
    isShareable: true,
  };
}

export interface SharedThreadView {
  threadId: string;
  title: string | null;
  sharedBy: string;
  sharedAt: number;
  agentSlug: string | null;
  messages: Array<{
    id: string;
    role: string;
    parts: unknown;
    sequence: number;
    model: string | null;
    providerSlug: string | null;
    blockedReason: string | null;
    error: string | null;
    createdAt: number;
  }>;
}

/**
 * Resolve a share token to its read-only snapshot. The token authorizes the
 * read TOGETHER with org membership (checked by the route's door — the org
 * is resolved FROM the thread here and compared). The snapshot is cut at
 * `sharedAt`; unknown token, unshared thread, trashed or aged-out thread,
 * and cross-org caller are indistinguishable nulls by design — the
 * lifecycle gate is the one every other read applies, so deleting a
 * conversation revokes what its link serves.
 */
export async function getSharedThread(
  sql: Sql,
  callerOrgIds: string[],
  shareToken: string,
): Promise<SharedThreadView | null> {
  const rows = await sql<ThreadRow[]>`
    SELECT ${sql.unsafe(THREAD_COLUMNS)}
    FROM app.threads t
    JOIN app.thread_metadata tm ON tm.thread_id = t.id
    WHERE tm.share_token = ${shareToken} AND tm.status = 'active'
    LIMIT 1
  `;
  const thread = rows[0];
  if (
    !thread ||
    thread.isShared !== true ||
    thread.sharedAt === null ||
    thread.sharedBy === null ||
    !callerOrgIds.includes(thread.organizationId)
  ) {
    return null;
  }
  const sharedAt = thread.sharedAt;
  const messages = await sql<
    {
      id: string;
      role: string;
      parts: unknown;
      order: number;
      stepOrder: number;
      model: string | null;
      providerSlug: string | null;
      blockedReason: string | null;
      error: string | null;
      createdAt: number;
    }[]
  >`
    SELECT id, role, parts, "order", step_order AS "stepOrder", model,
           provider_slug AS "providerSlug", blocked_reason AS "blockedReason",
           error, created_at_ms::float8 AS "createdAt"
    FROM app.messages
    WHERE thread_id = ${thread.id} AND created_at_ms <= ${sharedAt}
    ORDER BY "order", step_order
  `;
  return {
    threadId: thread.id,
    title: thread.title,
    sharedBy: thread.sharedBy,
    sharedAt,
    agentSlug: thread.agentSlug,
    messages: messages.map((message, index) => ({
      id: message.id,
      role: message.role,
      parts: message.parts,
      sequence: index,
      model: message.model,
      providerSlug: message.providerSlug,
      blockedReason: message.blockedReason,
      error: message.error,
      createdAt: message.createdAt,
    })),
  };
}

/**
 * Fork a thread at a message: a new thread carrying the conversation up to
 * and including that message. The copy keeps its (order, stepOrder) layout —
 * a self-contained history that never shares row identity with its parent.
 */
export async function branchThread(
  sql: Sql,
  organizationId: string,
  userId: string,
  threadId: string,
  fromMessageId: string,
  title?: string,
): Promise<string | null> {
  const thread = await loadOwnedThread(sql, organizationId, userId, threadId);
  if (!thread) return null;
  const forks = await sql<{ order: number; stepOrder: number }[]>`
    SELECT "order", step_order AS "stepOrder" FROM app.messages
    WHERE id = ${fromMessageId} AND thread_id = ${thread.id}
    LIMIT 1
  `;
  const fork = forks[0];
  if (!fork) return null;
  const now = Date.now();
  return sql.begin(async (tx) => {
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO app.threads (org_id, user_id, title, kind, created_at_ms,
                               updated_at_ms)
      VALUES (${organizationId}, ${userId},
              ${title?.trim() || thread.title}, ${thread.kind}, ${now}, ${now})
      RETURNING id
    `;
    const branchId = inserted[0]?.id;
    if (!branchId) throw new Error('branch insert failed');
    await tx`
      INSERT INTO app.thread_metadata (
        thread_id, org_id, user_id, chat_type, status, agent_slug,
        reasoning_effort, branched_from_message_id, created_at_ms
      ) VALUES (
        ${branchId}, ${organizationId}, ${userId}, ${thread.kind}, 'active',
        ${thread.agentSlug}, ${thread.reasoningEffort}, ${fromMessageId},
        ${now}
      )
    `;
    await tx`
      INSERT INTO app.messages (
        thread_id, org_id, "order", step_order, role, parts, text, model,
        provider_slug, usage, blocked_reason, error, status, created_at_ms
      )
      SELECT ${branchId}, org_id, "order", step_order, role, parts, text,
             model, provider_slug, usage, blocked_reason, error, status,
             ${now}
      FROM app.messages
      WHERE thread_id = ${thread.id}
        AND ("order", step_order) <= (${fork.order}, ${fork.stepOrder})
      ORDER BY "order", step_order
    `;
    return branchId;
  });
}

/**
 * Move a thread to Trash. Owner-gated; refuses while a turn is generating.
 * Idempotent. The lineage travels together (hidden branch siblings via
 * `branch_root_id`). Legal holds ride the retention/holds port.
 */
export async function trashThread(
  sql: Sql,
  auth: { organizationId: string; userId: string; email?: string },
  threadId: string,
): Promise<boolean> {
  const rows = await sql<ThreadRow[]>`
    SELECT ${sql.unsafe(THREAD_COLUMNS)}
    FROM app.threads t
    JOIN app.thread_metadata tm ON tm.thread_id = t.id
    WHERE t.id = ${threadId} AND t.org_id = ${auth.organizationId}
      AND t.user_id = ${auth.userId}
    LIMIT 1
  `;
  const thread = rows[0];
  if (!thread) return false;
  if (thread.status === 'trashed') return true;
  if (thread.status !== 'active') return false;
  const generating = await sql<{ threadId: string }[]>`
    SELECT thread_id AS "threadId" FROM app.generations
    WHERE thread_id = ${thread.id} LIMIT 1
  `;
  if (generating.length > 0) return false;
  // Throws LEGAL_HOLD_ACTIVE when the org — or this owner, as a custodian —
  // is under an active hold.
  await assertNotHeld(
    sql,
    auth.organizationId,
    'thread',
    thread.id,
    undefined,
    thread.userId,
  );
  const now = Date.now();
  await sql.begin(async (tx) => {
    await tx`
      UPDATE app.thread_metadata SET
        status = 'trashed', status_changed_at_ms = ${now}
      WHERE thread_id = ${thread.id}
    `;
    await tx`
      UPDATE app.thread_metadata SET
        status = 'trashed', status_changed_at_ms = ${now}
      WHERE branch_root_id = ${thread.id} AND status = 'active'
    `;
    await createAuditLog(tx, {
      organizationId: auth.organizationId,
      actorId: auth.userId,
      ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
      actorType: 'user',
      action: 'chat_thread.trashed',
      category: 'data',
      resourceType: 'thread',
      resourceId: thread.id,
      ...(thread.title !== null ? { resourceName: thread.title } : {}),
      status: 'success',
    });
  });
  return true;
}

/** The owner's self-restore for a thread still in the grace window — only a
 * 'trashed' thread restores here (an 'expired' one was aged out). */
export async function restoreThread(
  sql: Sql,
  auth: { organizationId: string; userId: string; email?: string },
  threadId: string,
): Promise<boolean> {
  const rows = await sql<ThreadRow[]>`
    SELECT ${sql.unsafe(THREAD_COLUMNS)}
    FROM app.threads t
    JOIN app.thread_metadata tm ON tm.thread_id = t.id
    WHERE t.id = ${threadId} AND t.org_id = ${auth.organizationId}
      AND t.user_id = ${auth.userId}
    LIMIT 1
  `;
  const thread = rows[0];
  if (!thread || thread.status !== 'trashed') return false;
  // A hold freezes the trash state in place — restore included.
  const holds = await loadActiveHolds(sql, auth.organizationId);
  if (holds.orgHeld || holds.userMembershipIds.has(thread.userId)) {
    return false;
  }
  const now = Date.now();
  await sql.begin(async (tx) => {
    await tx`
      UPDATE app.thread_metadata SET
        status = 'active', status_changed_at_ms = ${now}
      WHERE thread_id = ${thread.id}
    `;
    await tx`
      UPDATE app.thread_metadata SET
        status = 'active', status_changed_at_ms = ${now}
      WHERE branch_root_id = ${thread.id} AND status = 'trashed'
    `;
    await createAuditLog(tx, {
      organizationId: auth.organizationId,
      actorId: auth.userId,
      ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
      actorType: 'user',
      action: 'chat_thread.restored_by_user',
      category: 'data',
      resourceType: 'thread',
      resourceId: thread.id,
      ...(thread.title !== null ? { resourceName: thread.title } : {}),
      status: 'success',
    });
  });
  return true;
}

/** More rows than any tab wants to render — a budget, not pagination. */
const PROJECT_THREADS_CAP = 200;

export interface ProjectThreadRow {
  id: string;
  title: string | null;
  updatedAt: number;
  sharedWithProject: boolean | null;
  userId: string;
  authorName: string | null;
}

/** The project page's Chats tab: the caller's own conversations in the
 * project, and the ones other members shared with it. */
export async function listThreadsForProject(
  sql: Sql,
  organizationId: string,
  userId: string,
  projectId: string,
): Promise<{ mine: ProjectThreadRow[]; shared: ProjectThreadRow[] }> {
  const access = await projectChatAccess(sql, {
    projectId,
    organizationId,
    userId,
  });
  if (access !== 'ok') return { mine: [], shared: [] };
  const rows = await sql<
    {
      id: string;
      title: string | null;
      updatedAt: number;
      sharedWithProject: boolean | null;
      userId: string;
      authorName: string | null;
    }[]
  >`
    SELECT t.id, t.title, t.updated_at_ms::float8 AS "updatedAt",
           tm.shared_with_project AS "sharedWithProject",
           t.user_id AS "userId", u."name" AS "authorName"
    FROM app.threads t
    JOIN app.thread_metadata tm ON tm.thread_id = t.id
    LEFT JOIN "user" u ON u."id" = t.user_id
    WHERE t.org_id = ${organizationId} AND tm.project_id = ${projectId}
      AND tm.status = 'active' AND tm.hidden IS NOT true
    ORDER BY t.updated_at_ms DESC
    LIMIT ${PROJECT_THREADS_CAP}
  `;
  const mine = rows.filter((row) => row.userId === userId);
  const shared = rows.filter(
    (row) => row.userId !== userId && row.sharedWithProject === true,
  );
  const project = (row: (typeof rows)[number]): ProjectThreadRow => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt,
    sharedWithProject: row.sharedWithProject,
    userId: row.userId,
    authorName: row.authorName,
  });
  return { mine: mine.map(project), shared: shared.map(project) };
}

/** Newest threads scanned per search; newest messages per thread; result and
 * snippet budgets — the 0.4 palette-search caps, verbatim. */
const SCAN_THREADS = 40;
const SCAN_MESSAGES = 30;
const MAX_RESULTS = 25;
const SNIPPET_MAX_CHARS = 600;

export interface ChatSearchHit {
  threadId: string;
  title: string | null;
  snippet: string;
  updatedAt: number;
}

/**
 * Chat search for the ⌘K palette — the 0.4 bounded, recency-biased scan:
 * the caller's newest ACTIVE threads, per thread their newest messages,
 * AND-matching lowercased tokens. A bounded miss beats an unbounded walk.
 */
export async function searchChats(
  sql: Sql,
  organizationId: string,
  userId: string,
  queryText: string,
): Promise<ChatSearchHit[]> {
  const tokens = queryText
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return [];
  const threads = await sql<
    { id: string; title: string | null; updatedAt: number }[]
  >`
    SELECT t.id, t.title, t.updated_at_ms::float8 AS "updatedAt"
    FROM app.threads t
    JOIN app.thread_metadata tm ON tm.thread_id = t.id
    WHERE t.org_id = ${organizationId} AND t.user_id = ${userId}
      AND tm.status = 'active' AND tm.archived = false
      AND tm.hidden IS NOT true
    ORDER BY t.updated_at_ms DESC
    LIMIT ${SCAN_THREADS}
  `;
  if (threads.length === 0) return [];
  const recent = await sql<
    { threadId: string; text: string | null; rank: number }[]
  >`
    SELECT thread_id AS "threadId", text, rank FROM (
      SELECT thread_id, text,
             row_number() OVER (
               PARTITION BY thread_id
               ORDER BY "order" DESC, step_order DESC
             ) AS rank
      FROM app.messages
      WHERE thread_id IN ${sql(threads.map((thread) => thread.id))}
    ) ranked
    WHERE rank <= ${SCAN_MESSAGES}
    ORDER BY "threadId", rank
  `;
  const byThread = new Map<string, { text: string | null }[]>();
  for (const row of recent) {
    const list = byThread.get(row.threadId) ?? [];
    list.push({ text: row.text });
    byThread.set(row.threadId, list);
  }
  const matchesEvery = (haystack: string): boolean =>
    tokens.every((token) => haystack.includes(token));
  const results: ChatSearchHit[] = [];
  for (const thread of threads) {
    if (results.length >= MAX_RESULTS) break;
    const titleMatches = matchesEvery((thread.title ?? '').toLowerCase());
    const messages = byThread.get(thread.id) ?? [];
    const matching = messages.find((message) =>
      matchesEvery((message.text ?? '').toLowerCase()),
    );
    if (!titleMatches && matching === undefined) continue;
    const snippetSource = matching?.text ?? messages[0]?.text ?? '';
    results.push({
      threadId: thread.id,
      title: thread.title,
      snippet: snippetSource.trim().slice(0, SNIPPET_MAX_CHARS),
      updatedAt: thread.updatedAt,
    });
  }
  return results;
}

// --- edit / regenerate sibling branches --------------------------------------

/** Selections beyond this are dropped oldest-first — a bound, not a quota. */
const MAX_BRANCH_SELECTIONS = 50;

/**
 * Copy `parent`'s conversation up to `copyThrough` (inclusive, by `order`)
 * into a fresh HIDDEN sibling forked at `forkSequence`. The branch inherits
 * everything a turn reads from the thread (agent, capabilities, project) so
 * a turn into it behaves exactly like one into the parent. Chat appends are
 * flat (`step_order` 0, `order` = the 0.4 sequence), so order comparisons
 * ARE the 0.4 sequence comparisons and the copy stays gap-free from zero.
 */
async function createBranchSibling(
  sql: Sql,
  parent: ThreadRow,
  forkSequence: number,
  copyThrough: number,
): Promise<string> {
  const now = Date.now();
  const rootId = parent.branchRootId ?? parent.id;
  return sql.begin(async (tx) => {
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO app.threads (org_id, user_id, title, kind, created_at_ms,
                               updated_at_ms)
      VALUES (${parent.organizationId}, ${parent.userId}, ${parent.title},
              ${parent.kind}, ${now}, ${now})
      RETURNING id
    `;
    const branchId = inserted[0]?.id;
    if (!branchId) throw new Error('branch insert failed');
    const capabilities = readCapabilities(parent.capabilities);
    await tx`
      INSERT INTO app.thread_metadata (
        thread_id, org_id, user_id, chat_type, status, project_id,
        agent_slug, harness, capabilities, reasoning_effort, hidden,
        branch_root_id, branch_parent_id, branch_fork_sequence,
        created_at_ms
      ) VALUES (
        ${branchId}, ${parent.organizationId}, ${parent.userId},
        ${parent.kind}, 'active', ${parent.projectId}, ${parent.agentSlug},
        ${parent.harness},
        ${capabilities === null ? null : tx.json(toJson(capabilities))},
        ${parent.reasoningEffort}, true, ${rootId}, ${parent.id},
        ${forkSequence}, ${now}
      )
    `;
    await tx`
      INSERT INTO app.messages (
        thread_id, org_id, "order", step_order, role, parts, text, model,
        provider_slug, usage, blocked_reason, error, status, created_at_ms
      )
      SELECT ${branchId}, org_id, "order", step_order, role, parts, text,
             model, provider_slug, usage, blocked_reason, error, status,
             ${now}
      FROM app.messages
      WHERE thread_id = ${parent.id} AND "order" <= ${copyThrough}
      ORDER BY "order", step_order
    `;
    return branchId;
  });
}

/**
 * Fork for an EDIT: the branch carries everything BEFORE the edited user
 * message; the client then sends the edited text into the branch through
 * the normal turn, which appends it at the same sequence the original held.
 */
export async function branchForEdit(
  sql: Sql,
  organizationId: string,
  userId: string,
  threadId: string,
  editedMessageId: string,
): Promise<string | null> {
  const thread = await loadOwnedThread(sql, organizationId, userId, threadId);
  if (!thread) return null;
  const messages = await sql<{ order: number; role: string }[]>`
    SELECT "order", role FROM app.messages
    WHERE id = ${editedMessageId} AND thread_id = ${thread.id}
    LIMIT 1
  `;
  const message = messages[0];
  if (!message || message.role !== 'user') return null;
  return createBranchSibling(sql, thread, message.order, message.order - 1);
}

/**
 * Fork for a REGENERATE: the branch carries everything THROUGH the user
 * message the chosen assistant reply answered; the turn then re-runs that
 * prompt without appending it again (`resend`).
 */
export async function branchForRegenerate(
  sql: Sql,
  organizationId: string,
  userId: string,
  threadId: string,
  assistantMessageId: string,
): Promise<string | null> {
  const thread = await loadOwnedThread(sql, organizationId, userId, threadId);
  if (!thread) return null;
  const messages = await sql<{ order: number; role: string }[]>`
    SELECT "order", role FROM app.messages
    WHERE id = ${assistantMessageId} AND thread_id = ${thread.id}
    LIMIT 1
  `;
  const message = messages[0];
  if (!message || message.role !== 'assistant') return null;
  const prompts = await sql<{ order: number }[]>`
    SELECT "order" FROM app.messages
    WHERE thread_id = ${thread.id} AND role = 'user'
      AND "order" < ${message.order}
    ORDER BY "order" DESC
    LIMIT 1
  `;
  const prompt = prompts[0];
  if (!prompt) return null;
  return createBranchSibling(sql, thread, prompt.order, prompt.order);
}

export interface BranchInfo {
  id: string;
  parentId: string;
  forkSequence: number;
  createdAt: number;
}

/** A root's whole lineage in one read: its live branches plus the root's
 * selection map — one watch serves the navigator. */
export async function listThreadBranches(
  sql: Sql,
  organizationId: string,
  userId: string,
  rootThreadId: string,
): Promise<{ branches: BranchInfo[]; selections: string | null }> {
  const root = await loadOwnedThread(sql, organizationId, userId, rootThreadId);
  if (!root) return { branches: [], selections: null };
  const rows = await sql<
    {
      id: string;
      parentId: string | null;
      forkSequence: number | null;
      createdAt: number;
    }[]
  >`
    SELECT t.id, tm.branch_parent_id AS "parentId",
           tm.branch_fork_sequence AS "forkSequence",
           t.created_at_ms::float8 AS "createdAt"
    FROM app.thread_metadata tm
    JOIN app.threads t ON t.id = tm.thread_id
    WHERE tm.branch_root_id = ${root.id} AND tm.status = 'active'
      AND tm.branch_parent_id IS NOT NULL
    ORDER BY t.created_at_ms
  `;
  const selections = await sql<{ branchSelections: string | null }[]>`
    SELECT branch_selections AS "branchSelections"
    FROM app.thread_metadata WHERE thread_id = ${root.id}
  `;
  return {
    branches: rows.map((row) => ({
      id: row.id,
      parentId: row.parentId ?? root.id,
      forkSequence: row.forkSequence ?? 0,
      createdAt: row.createdAt,
    })),
    selections: selections[0]?.branchSelections ?? null,
  };
}

/** The lineage a turn's retrieval scope covers: root + every sibling —
 * attachments upload against whichever sibling the URL shows while the turn
 * runs on the active branch. Falls back to the id it was given. */
export async function getThreadLineageIds(
  sql: Sql,
  organizationId: string,
  threadId: string,
): Promise<{ rootId: string; threadIds: string[] }> {
  const rows = await sql<{ branchRootId: string | null }[]>`
    SELECT tm.branch_root_id AS "branchRootId"
    FROM app.thread_metadata tm
    JOIN app.threads t ON t.id = tm.thread_id
    WHERE tm.thread_id = ${threadId} AND t.org_id = ${organizationId}
    LIMIT 1
  `;
  if (rows.length === 0) {
    return { rootId: threadId, threadIds: [threadId] };
  }
  const rootId = rows[0]?.branchRootId ?? threadId;
  const siblings = await sql<{ threadId: string }[]>`
    SELECT tm.thread_id AS "threadId"
    FROM app.thread_metadata tm
    JOIN app.threads t ON t.id = tm.thread_id
    WHERE tm.branch_root_id = ${rootId} AND t.org_id = ${organizationId}
  `;
  const ids = new Set<string>([threadId, rootId]);
  for (const sibling of siblings) ids.add(sibling.threadId);
  return { rootId, threadIds: [...ids] };
}

/** Record which sibling a fork point shows — stored on the ROOT as a JSON
 * map keyed `"<parentId>:<forkSequence>"`, bounded oldest-first. A metadata
 * edit: `updatedAt` stays untouched. */
export async function setBranchSelection(
  sql: Sql,
  organizationId: string,
  userId: string,
  rootThreadId: string,
  forkKey: string,
  selectedThreadId: string,
): Promise<void> {
  const root = await loadOwnedThread(sql, organizationId, userId, rootThreadId);
  if (!root) return;
  const current = await sql<{ branchSelections: string | null }[]>`
    SELECT branch_selections AS "branchSelections"
    FROM app.thread_metadata WHERE thread_id = ${root.id}
  `;
  let selections: Record<string, string> = {};
  const raw = current[0]?.branchSelections;
  if (raw !== null && raw !== undefined) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string') selections[key] = value;
        }
      }
    } catch (error) {
      console.warn('[chat] unreadable branch selections were reset', error);
    }
  }
  selections[forkKey] = selectedThreadId;
  const keys = Object.keys(selections);
  if (keys.length > MAX_BRANCH_SELECTIONS) {
    selections = Object.fromEntries(
      keys
        .slice(keys.length - MAX_BRANCH_SELECTIONS)
        .map((key) => [key, selections[key] ?? '']),
    );
  }
  await sql`
    UPDATE app.thread_metadata SET
      branch_selections = ${JSON.stringify(selections)}
    WHERE thread_id = ${root.id}
  `;
}
