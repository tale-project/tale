import type { Sql } from 'postgres';

import { createAuditLog } from '../audit_logs/service.ts';

/**
 * Memories — durable facts about a person, gated behind approval; the 0.5
 * twin of `convex/chat/memories.ts`. A memory is a TOOL result, never an
 * ambient injection: it lands `pending` and becomes readable only once its
 * OWNER approves it. Every read and write scopes by BOTH organization and
 * user, and retrieval additionally filters to `approved`. Proposing is an
 * auditable act independent of any later approval.
 */

export interface MemoryRecord {
  id: string;
  organizationId: string;
  userId: string;
  content: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
}

/** Save a pending memory and record the proposal in the audit trail. */
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
    throw new Error('A memory cannot be empty.');
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

/** The approved memories the model may read — approved-only, (org, user)
 * scoped, so retrieval can never surface a proposal or another person's. */
export async function searchApprovedMemories(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    query?: string;
    limit?: number;
  },
): Promise<MemoryRecord[]> {
  const rows = await sql<MemoryRecord[]>`
    SELECT id, org_id AS "organizationId", user_id AS "userId", content,
           status, created_at_ms::float8 AS "createdAt"
    FROM app.memories
    WHERE org_id = ${args.organizationId} AND user_id = ${args.userId}
      AND status = 'approved'
    ORDER BY created_at_ms DESC
  `;
  const queryText = args.query?.toLowerCase();
  return rows
    .filter(
      (memory) =>
        queryText === undefined ||
        memory.content.toLowerCase().includes(queryText),
    )
    .slice(0, args.limit ?? 20);
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
    ORDER BY created_at_ms DESC
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
 * decides. False when the memory is not the caller's. */
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
      AND user_id = ${args.userId}
    RETURNING id
  `;
  return rows.length > 0;
}
