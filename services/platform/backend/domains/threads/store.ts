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

/** The most messages one read may ask for, on either lane below. */
export const THREAD_MESSAGES_READ_MAX = 500;

/**
 * Ordered page of a thread's messages (ascending, keyset by order) — the
 * REPLAY lane: a reader walking a thread from its start (`afterOrder` = the
 * previous page's last order). A surface that must show what is NEWEST reads
 * {@link listThreadMessagesTail} instead — a fixed ascending window keeps
 * the first N turns forever and hides every later one.
 */
export async function listThreadMessages(
  sql: Sql | TransactionSql,
  threadId: string,
  options: {
    afterOrder?: number;
    limit?: number;
    excludeToolRoles?: boolean;
  } = {},
): Promise<MessageRow[]> {
  const limit = Math.min(options.limit ?? 200, THREAD_MESSAGES_READ_MAX);
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

/** A position in a thread's (order, step_order) sequence — the keyset the
 * tail read walks backwards from. */
export interface ThreadMessageCursor {
  order: number;
  stepOrder: number;
}

/**
 * The NEWEST page of a thread — the last `limit` messages (or the `limit`
 * strictly before `before`), answered in chronological order with whether
 * older ones remain. The SURFACE lane: a discussion or feed reads its tail
 * first so a fresh message is always visible, and walks older pages through
 * `nextBefore`. One row past the limit is fetched to answer `hasMore`
 * without a count.
 */
export async function listThreadMessagesTail(
  sql: Sql | TransactionSql,
  threadId: string,
  options: {
    before?: ThreadMessageCursor;
    limit?: number;
    excludeToolRoles?: boolean;
  } = {},
): Promise<{
  /** Chronological within the page (oldest first). */
  messages: MessageRow[];
  /** Whether messages older than this page exist. */
  hasMore: boolean;
  /** The cursor for the next older page; null once the start is reached. */
  nextBefore: ThreadMessageCursor | null;
}> {
  const limit = Math.min(
    Math.max(options.limit ?? 200, 1),
    THREAD_MESSAGES_READ_MAX,
  );
  const excludeTools = options.excludeToolRoles ?? true;
  const before = options.before ?? null;
  const rows = await sql<MessageRow[]>`
    SELECT ${sql.unsafe(MESSAGE_COLUMNS)} FROM app.messages
    WHERE thread_id = ${threadId}
      AND (${before === null}
        OR ("order", step_order) < (${before?.order ?? 0}, ${before?.stepOrder ?? 0}))
      AND (${!excludeTools} OR role IN ('user', 'assistant'))
    ORDER BY "order" DESC, step_order DESC
    LIMIT ${limit + 1}
  `;
  const hasMore = rows.length > limit;
  const page = (hasMore ? rows.slice(0, limit) : rows).reverse();
  const oldest = page[0];
  return {
    messages: page,
    hasMore,
    nextBefore:
      hasMore && oldest !== undefined
        ? { order: oldest.order, stepOrder: oldest.stepOrder }
        : null,
  };
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
