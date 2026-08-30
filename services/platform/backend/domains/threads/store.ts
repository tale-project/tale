import type { Sql, TransactionSql } from 'postgres';

import { toJson } from '../../db/sql.ts';

/**
 * The message store — the 0.5 replacement for the `@convex-dev/agent`
 * component's thread/message tables. Deliberately surface-minimal: threads,
 * ordered messages ((order, step_order) exactly like the component), and the
 * reads the current consumers need (task/project discussions now, the chat
 * engine next). Streaming deltas ride the Tier-1 SSE lane when chat lands —
 * the store persists only settled messages.
 */

export interface ThreadRow {
  id: string;
  organizationId: string;
  userId: string | null;
  title: string | null;
  kind: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MessageRow {
  id: string;
  threadId: string;
  order: number;
  stepOrder: number;
  role: 'user' | 'assistant' | 'system' | 'tool';
  parts: unknown;
  text: string | null;
  authorId: string | null;
  status: string;
  createdAt: number;
}

const MESSAGE_COLUMNS = `
  id, thread_id AS "threadId", "order", step_order AS "stepOrder", role,
  parts, text, author_id AS "authorId", status,
  created_at_ms::float8 AS "createdAt"
`;

export async function createThread(
  tx: TransactionSql,
  args: {
    organizationId: string;
    userId?: string;
    title?: string;
    kind?: string;
  },
): Promise<string> {
  const now = Date.now();
  const rows = await tx<{ id: string }[]>`
    INSERT INTO app.threads (org_id, user_id, title, kind, created_at_ms, updated_at_ms)
    VALUES (${args.organizationId}, ${args.userId ?? null},
            ${args.title ?? null}, ${args.kind ?? null}, ${now}, ${now})
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) {
    throw new Error('thread insert failed');
  }
  return id;
}

export async function getThread(
  sql: Sql | TransactionSql,
  threadId: string,
): Promise<ThreadRow | null> {
  const rows = await sql<ThreadRow[]>`
    SELECT id, org_id AS "organizationId", user_id AS "userId", title, kind,
           created_at_ms::float8 AS "createdAt",
           updated_at_ms::float8 AS "updatedAt"
    FROM app.threads WHERE id = ${threadId} LIMIT 1
  `;
  return rows[0] ?? null;
}

export interface SaveMessageArgs {
  threadId: string;
  organizationId: string;
  role: MessageRow['role'];
  /** Plain text content (discussions); chat turns add `parts`. */
  text?: string;
  parts?: unknown;
  authorId?: string;
  status?: 'pending' | 'complete' | 'failed' | 'cancelled';
}

/**
 * Append a message as the next turn: claims `max(order)+1` with
 * `step_order = 0`. Callers appending STEPS of an existing turn use
 * `saveMessageStep`. Runs inside the caller's serializable transaction, so
 * two concurrent appends to one thread serialize (one retries).
 */
export async function saveMessage(
  tx: TransactionSql,
  args: SaveMessageArgs,
): Promise<{ messageId: string; order: number }> {
  const orderRows = await tx<{ next: number }[]>`
    SELECT coalesce(max("order"), -1) + 1 AS next FROM app.messages
    WHERE thread_id = ${args.threadId}
  `;
  const order = orderRows[0]?.next ?? 0;
  const rows = await tx<{ id: string }[]>`
    INSERT INTO app.messages (
      thread_id, org_id, "order", step_order, role, parts, text, author_id,
      status, created_at_ms
    ) VALUES (
      ${args.threadId}, ${args.organizationId}, ${order}, 0, ${args.role},
      ${args.parts === undefined ? null : tx.json(toJson(args.parts))},
      ${args.text ?? null}, ${args.authorId ?? null},
      ${args.status ?? 'complete'}, ${Date.now()}
    )
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) {
    throw new Error('message insert failed');
  }
  await tx`
    UPDATE app.threads SET updated_at_ms = ${Date.now()}
    WHERE id = ${args.threadId}
  `;
  return { messageId: id, order };
}

/** Ordered page of a thread's messages (ascending, keyset by order). */
export async function listThreadMessages(
  sql: Sql | TransactionSql,
  threadId: string,
  options: {
    afterOrder?: number;
    limit?: number;
    excludeToolRoles?: boolean;
  } = {},
): Promise<MessageRow[]> {
  const limit = Math.min(options.limit ?? 200, 500);
  const afterOrder = options.afterOrder ?? -1;
  const excludeTools = options.excludeToolRoles ?? true;
  return sql<MessageRow[]>`
    SELECT ${sql.unsafe(MESSAGE_COLUMNS)} FROM app.messages
    WHERE thread_id = ${threadId}
      AND "order" > ${afterOrder}
      AND (${!excludeTools} OR role IN ('user', 'assistant'))
    ORDER BY "order" ASC, step_order ASC
    LIMIT ${limit}
  `;
}

export async function updateMessageText(
  tx: TransactionSql,
  messageId: string,
  text: string,
): Promise<void> {
  await tx`UPDATE app.messages SET text = ${text} WHERE id = ${messageId}`;
}

export async function deleteMessage(
  tx: TransactionSql,
  messageId: string,
): Promise<void> {
  await tx`DELETE FROM app.messages WHERE id = ${messageId}`;
}
