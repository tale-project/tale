import type { Sql } from 'postgres';

import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { getMyPreferences } from '../user_preferences/service.ts';

/**
 * Memories — durable facts about a person, gated behind approval; the 0.5
 * twin of `convex/chat/memories.ts`. A memory is a TOOL result, never an
 * ambient injection: it lands `pending` and becomes readable only once its
 * OWNER approves it. Every read and write scopes by BOTH organization and
 * user, and retrieval additionally filters to `approved`. Proposing is an
 * auditable act independent of any later approval.
 *
 * The feature itself is a knob the person and the org hold: the user's
 * `memories_enabled` preference overrides the org's `user_memories` policy
 * default, and with neither set it is OFF (the governance schema's
 * posture). A proposal while it is off is refused, not queued; retrieval
 * while it is off answers nothing. The listing and review doors are not
 * gated — a person may always see and settle what was proposed about them.
 */

export interface MemoryRecord {
  id: string;
  organizationId: string;
  userId: string;
  content: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
}

export class MemoryError extends Error {
  readonly code: string;
  readonly status: 400 | 403;

  constructor(code: string, message: string, status: 400 | 403 = 400) {
    super(message);
    this.name = 'MemoryError';
    this.code = code;
    this.status = status;
  }
}

/** The retrieval cap (`memory.search` asks for at most this many). */
const SEARCH_LIMIT_MAX = 50;
const SEARCH_LIMIT_DEFAULT = 20;
/** More rows than the preferences page can review at once — a bound, not
 * pagination: a person accrues proposals one conversation at a time. */
const LIST_LIMIT = 200;

/**
 * Is the memories feature on for this (org, user)? The person's explicit
 * preference wins; otherwise the org policy's default; otherwise OFF. The
 * same cascade the preferences page renders (`resolveGate`).
 */
export async function isMemoriesEnabled(
  sql: Sql,
  scope: { organizationId: string; userId: string },
): Promise<boolean> {
  const preferences = await getMyPreferences(sql, {
    userId: scope.userId,
    orgId: scope.organizationId,
  });
  if (preferences?.memoriesEnabled !== undefined) {
    return preferences.memoriesEnabled;
  }
  const policy = await readGovernancePolicyForOrg(
    sql,
    scope.organizationId,
    'user_memories',
  );
  return policy?.enabled === true;
}

/** Save a pending memory and record the proposal in the audit trail.
 * Refused (`MEMORIES_DISABLED`) while the feature is off for the person. */
export async function saveMemory(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    email?: string;
    content: string;
    sourceThreadId?: string;
    sourceMessageId?: string;
  },
): Promise<string> {
  const content = args.content.trim();
  if (content.length === 0) {
    throw new MemoryError('EMPTY_MEMORY', 'A memory cannot be empty.');
  }
  if (!(await isMemoriesEnabled(sql, args))) {
    throw new MemoryError(
      'MEMORIES_DISABLED',
      'Memories are turned off for this account — nothing was saved.',
      403,
    );
  }
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      INSERT INTO app.memories (
        org_id, user_id, content, status, source_thread_id,
        source_message_id, created_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.userId}, ${content}, 'pending',
        ${args.sourceThreadId ?? null}, ${args.sourceMessageId ?? null},
        ${Date.now()}
      ) RETURNING id
    `;
    const id = rows[0]?.id;
    if (!id) throw new Error('memory insert failed');
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.userId,
      ...(args.email !== undefined ? { actorEmail: args.email } : {}),
      actorType: 'user',
      action: 'memory.save',
      category: 'ai',
      resourceType: 'chat_memory',
      resourceId: id,
      status: 'success',
      ...(args.sourceThreadId !== undefined
        ? { metadata: { threadId: args.sourceThreadId } }
        : {}),
    });
    return id;
  });
}

/** A LIKE pattern that matches the query as literal text. */
function containsPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** The approved memories the model may read — approved-only, (org, user)
 * scoped, so retrieval can never surface a proposal or another person's;
 * nothing at all while the feature is off for the person. The filter and
 * the cap ride the query. */
export async function searchApprovedMemories(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    query?: string;
    limit?: number;
  },
): Promise<MemoryRecord[]> {
  if (!(await isMemoriesEnabled(sql, args))) return [];
  const limit = Math.min(
    Math.max(Math.trunc(args.limit ?? SEARCH_LIMIT_DEFAULT), 1),
    SEARCH_LIMIT_MAX,
  );
  const query = args.query?.trim();
  const pattern =
    query !== undefined && query.length > 0 ? containsPattern(query) : null;
  return sql<MemoryRecord[]>`
    SELECT id, org_id AS "organizationId", user_id AS "userId", content,
           status, created_at_ms::float8 AS "createdAt"
    FROM app.memories
    WHERE org_id = ${args.organizationId} AND user_id = ${args.userId}
      AND status = 'approved'
      AND (${pattern}::text IS NULL OR content ILIKE ${pattern})
    ORDER BY created_at_ms DESC
    LIMIT ${limit}
  `;
}

/** The pending proposals and approved memories the preferences page reviews. */
export async function listMemories(
  sql: Sql,
  organizationId: string,
  userId: string,
): Promise<{
  pending: Array<{ id: string; content: string }>;
  approved: Array<{ id: string; content: string }>;
}> {
  const rows = await sql<{ id: string; content: string; status: string }[]>`
    SELECT id, content, status FROM app.memories
    WHERE org_id = ${organizationId} AND user_id = ${userId}
      AND status IN ('pending', 'approved')
    ORDER BY created_at_ms DESC
    LIMIT ${LIST_LIMIT}
  `;
  return {
    pending: rows
      .filter((row) => row.status === 'pending')
      .map((row) => ({ id: row.id, content: row.content })),
    approved: rows
      .filter((row) => row.status === 'approved')
      .map((row) => ({ id: row.id, content: row.content })),
  };
}

/** Approve or reject a pending memory — the model proposes, the person
 * decides. False when the memory is not the caller's or is not pending. */
export async function reviewMemory(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    memoryId: string;
    decision: 'approved' | 'rejected';
  },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE app.memories SET
      status = ${args.decision}, reviewed_by = ${args.userId},
      reviewed_at_ms = ${Date.now()}
    WHERE id = ${args.memoryId} AND org_id = ${args.organizationId}
      AND user_id = ${args.userId} AND status = 'pending'
    RETURNING id
  `;
  return rows.length > 0;
}

/** Delete a memory of the caller's — a saved one is taken out of what a
 * search can return, which is the whole of its effect. False when the
 * memory is not the caller's. */
export async function deleteMemory(
  sql: Sql,
  args: { organizationId: string; userId: string; memoryId: string },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM app.memories
    WHERE id = ${args.memoryId} AND org_id = ${args.organizationId}
      AND user_id = ${args.userId}
    RETURNING id
  `;
  return rows.length > 0;
}
