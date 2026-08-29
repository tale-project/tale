import type { Sql, TransactionSql } from 'postgres';

import { toJson } from '../../db/sql.ts';

/**
 * Message feedback — thumbs up/down on assistant messages, one row per
 * (message, user), upsert-on-revote. Every active member may read and write
 * (the one table the 0.4 matrix opens to `member` writes).
 */

export interface FeedbackScope {
  organizationId: string;
  userId: string;
}

export interface SubmitFeedbackArgs {
  threadId: string;
  messageId: string;
  rating: 'positive' | 'negative';
  comment?: string;
  agentSlug?: string;
  model?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
}

export async function submitMessageFeedback(
  tx: TransactionSql,
  scope: FeedbackScope,
  args: SubmitFeedbackArgs,
): Promise<void> {
  const now = Date.now();
  await tx`
    INSERT INTO app.message_feedback (
      org_id, thread_id, message_id, user_id, rating, comment, metadata,
      agent_slug, model, provider, created_at_ms
    ) VALUES (
      ${scope.organizationId}, ${args.threadId}, ${args.messageId},
      ${scope.userId}, ${args.rating}, ${args.comment ?? null},
      ${args.metadata === undefined ? null : tx.json(toJson(args.metadata))},
      ${args.agentSlug ?? null}, ${args.model ?? null},
      ${args.provider ?? null}, ${now}
    )
    ON CONFLICT (message_id, user_id) DO UPDATE SET
      rating = ${args.rating},
      comment = ${args.comment ?? null},
      created_at_ms = ${now}
  `;
}

export async function removeMessageFeedback(
  tx: TransactionSql,
  scope: FeedbackScope,
  messageId: string,
): Promise<void> {
  await tx`
    DELETE FROM app.message_feedback
    WHERE message_id = ${messageId} AND user_id = ${scope.userId}
      AND org_id = ${scope.organizationId}
  `;
}

export interface FeedbackRow {
  id: string;
  threadId: string;
  messageId: string;
  userId: string;
  rating: string;
  comment: string | null;
  agentSlug: string | null;
  model: string | null;
  createdAt: number;
}

/** The caller's own vote on one message (drives the toggle UI). */
export async function getMyMessageFeedback(
  sql: Sql,
  scope: FeedbackScope,
  messageId: string,
): Promise<FeedbackRow | null> {
  const rows = await sql<FeedbackRow[]>`
    SELECT id, thread_id AS "threadId", message_id AS "messageId",
           user_id AS "userId", rating, comment, agent_slug AS "agentSlug",
           model, created_at_ms::float8 AS "createdAt"
    FROM app.message_feedback
    WHERE message_id = ${messageId} AND user_id = ${scope.userId}
      AND org_id = ${scope.organizationId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** The caller's OWN ratings across one thread (the toolbar's latch read —
 * the 0.4 `listThreadFeedback` shape). */
export async function listMyThreadFeedback(
  sql: Sql,
  scope: FeedbackScope,
  threadId: string,
): Promise<
  { messageId: string; rating: 'positive' | 'negative'; comment?: string }[]
> {
  const rows = await sql<
    {
      messageId: string;
      rating: 'positive' | 'negative';
      comment: string | null;
    }[]
  >`
    SELECT message_id AS "messageId", rating, comment
    FROM app.message_feedback
    WHERE thread_id = ${threadId} AND user_id = ${scope.userId}
      AND org_id = ${scope.organizationId}
  `;
  return rows.map((row) =>
    Object.assign(
      { messageId: row.messageId, rating: row.rating },
      row.comment !== null ? { comment: row.comment } : {},
    ),
  );
}

/** Org-wide feedback feed + counts (the admin insights table). */
export async function listMessageFeedback(
  sql: Sql,
  organizationId: string,
  options: { rating?: 'positive' | 'negative'; limit?: number } = {},
): Promise<{
  items: FeedbackRow[];
  stats: { positive: number; negative: number };
}> {
  const limit = Math.min(options.limit ?? 100, 500);
  const items = await sql<FeedbackRow[]>`
    SELECT id, thread_id AS "threadId", message_id AS "messageId",
           user_id AS "userId", rating, comment, agent_slug AS "agentSlug",
           model, created_at_ms::float8 AS "createdAt"
    FROM app.message_feedback
    WHERE org_id = ${organizationId}
      AND lifecycle_status IS DISTINCT FROM 'trashed'
      AND (${options.rating ?? null}::text IS NULL OR rating = ${options.rating ?? null})
    ORDER BY created_at_ms DESC
    LIMIT ${limit}
  `;
  const stats = await sql<{ rating: string; count: string }[]>`
    SELECT rating, count(*)::text AS count FROM app.message_feedback
    WHERE org_id = ${organizationId}
      AND lifecycle_status IS DISTINCT FROM 'trashed'
    GROUP BY rating
  `;
  return {
    items,
    stats: {
      positive: Number(
        stats.find((s) => s.rating === 'positive')?.count ?? '0',
      ),
      negative: Number(
        stats.find((s) => s.rating === 'negative')?.count ?? '0',
      ),
    },
  };
}
