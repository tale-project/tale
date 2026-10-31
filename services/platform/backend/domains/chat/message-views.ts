import type { Sql } from 'postgres';

import {
  listThreadMessagesTail,
  type ThreadMessageCursor,
} from '../threads/store.ts';

/**
 * A transcript row as the chat lane ships it: the thread read and the
 * stream's `settled` event answer the same shape, so one reader owns it.
 */
export interface MessageView {
  id: string;
  role: string;
  parts: unknown;
  sequence: number;
  model?: string;
  providerSlug?: string;
  usage?: unknown;
  blockedReason?: string;
  error?: string;
  /** The row's terminal state — `cancelled` is how a user stop reads. */
  status?: string;
  createdAt: number;
}

type MessageViewRow = Omit<MessageView, 'model' | 'providerSlug' | 'usage'> & {
  model: string | null;
  providerSlug: string | null;
  usage: unknown;
};

/** The view's columns as the readers below select them, plus the keyset
 * the threads store's tail reader pages on. */
const MESSAGE_VIEW_PAGE_COLUMNS = `
  id, role, parts, "order" AS sequence, model,
  provider_slug AS "providerSlug", usage,
  blocked_reason AS "blockedReason", error, status,
  created_at_ms::float8 AS "createdAt",
  "order", step_order AS "stepOrder"
`;

function toMessageView(row: MessageViewRow): MessageView {
  return Object.assign(
    {
      id: row.id,
      role: row.role,
      parts: row.parts ?? [],
      sequence: row.sequence,
      createdAt: row.createdAt,
    },
    row.model !== null ? { model: row.model } : {},
    row.providerSlug !== null ? { providerSlug: row.providerSlug } : {},
    row.usage != null ? { usage: row.usage } : {},
    row.blockedReason != null ? { blockedReason: row.blockedReason } : {},
    row.error != null ? { error: row.error } : {},
    row.status != null ? { status: row.status } : {},
  );
}

/** The rows a chat transcript reads at once: its newest page, and each
 * older page a reader asks for. */
export const MESSAGE_VIEW_PAGE_SIZE = 200;

/** One page of a transcript and the way to the page before it. */
export interface MessageViewPage {
  /** In transcript order (oldest first). */
  messages: MessageView[];
  /** Whether rows older than this page exist. */
  hasMore: boolean;
  /** The cursor for the next older page; null once the start is reached. */
  nextBefore: ThreadMessageCursor | null;
}

/**
 * A thread's newest page of rows (or the page strictly before `before`),
 * every role included and scoped to the caller's organization — the
 * transcript reads its tail and walks back on request instead of reading the
 * whole thread. The keyset is the threads store's.
 */
export async function listMessageViewsPage(
  sql: Sql,
  organizationId: string,
  threadId: string,
  options: { before?: ThreadMessageCursor; limit?: number } = {},
): Promise<MessageViewPage> {
  const page = await listThreadMessagesTail<
    MessageViewRow & ThreadMessageCursor
  >(sql, threadId, {
    organizationId,
    excludeToolRoles: false,
    columns: MESSAGE_VIEW_PAGE_COLUMNS,
    limit: options.limit ?? MESSAGE_VIEW_PAGE_SIZE,
    ...(options.before !== undefined ? { before: options.before } : {}),
  });
  return {
    messages: page.messages.map(toMessageView),
    hasMore: page.hasMore,
    nextBefore: page.nextBefore,
  };
}

/**
 * The rows a set of settled turns produced, by message id, each checked
 * against its organization — what a turn's `settled` event carries, read
 * once for every stream watching it instead of a whole transcript per
 * stream.
 */
export async function readMessageViewsByIds(
  sql: Sql,
  pairs: readonly { organizationId: string; messageId: string }[],
): Promise<Map<string, MessageView>> {
  if (pairs.length === 0) return new Map();
  const ids = pairs.map((pair) => pair.messageId);
  const orgIds = pairs.map((pair) => pair.organizationId);
  const rows = await sql<MessageViewRow[]>`
    SELECT id, role, parts, "order" AS sequence, model,
           provider_slug AS "providerSlug", usage,
           blocked_reason AS "blockedReason", error, status,
           created_at_ms::float8 AS "createdAt"
    FROM app.messages
    WHERE (id, org_id) IN (
      SELECT * FROM unnest(${ids}::text[], ${orgIds}::text[])
    )
  `;
  return new Map(rows.map((row) => [row.id, toMessageView(row)]));
}

/** The newest row of a thread — the settle fallback for a turn whose
 * generation never named its message. */
export async function readLastMessageView(
  sql: Sql,
  organizationId: string,
  threadId: string,
): Promise<MessageView | null> {
  const rows = await sql<MessageViewRow[]>`
    SELECT id, role, parts, "order" AS sequence, model,
           provider_slug AS "providerSlug", usage,
           blocked_reason AS "blockedReason", error, status,
           created_at_ms::float8 AS "createdAt"
    FROM app.messages
    WHERE thread_id = ${threadId} AND org_id = ${organizationId}
    ORDER BY "order" DESC, step_order DESC
    LIMIT 1
  `;
  const row = rows[0];
  return row === undefined ? null : toMessageView(row);
}
