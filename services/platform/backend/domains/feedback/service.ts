import type { Sql, TransactionSql } from 'postgres';

/**
 * Message feedback — thumbs up/down on assistant messages, one row per
 * (message, user), upsert-on-revote. Every active member may read and write
 * (the one table the 0.4 matrix opens to `member` writes). A vote row never
 * carries metadata — that column belongs to the arena settle lane's verdict
 * rows (`domains/chat/arena.ts`), and its NULL-ness is what the vote's
 * partial unique index keys on.
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
}

export async function submitMessageFeedback(
  tx: TransactionSql,
  scope: FeedbackScope,
  args: SubmitFeedbackArgs,
): Promise<void> {
  const now = Date.now();
  // `metadata` is written NULL unconditionally: it is the vote's upsert key
  // (the partial unique index is `WHERE metadata IS NULL`), so a value here
  // would fork the key and let one member stack rows for one message.
  await tx`
    INSERT INTO app.message_feedback (
      org_id, thread_id, message_id, user_id, rating, comment, metadata,
      agent_slug, model, provider, created_at_ms
    ) VALUES (
      ${scope.organizationId}, ${args.threadId}, ${args.messageId},
      ${scope.userId}, ${args.rating}, ${args.comment ?? null}, NULL,
      ${args.agentSlug ?? null}, ${args.model ?? null},
      ${args.provider ?? null}, ${now}
    )
    ON CONFLICT (message_id, user_id) WHERE metadata IS NULL DO UPDATE SET
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

// ---------------------------------------------------------------- metrics

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SCAN_ALL_TIME = 5000;
const COMMENT_PROJECTION_MAX = 500;
const ARENA_VERDICTS = ['a_better', 'b_better', 'tie', 'both_bad'] as const;

interface FeedbackFoldRow {
  id: string;
  threadId: string;
  messageId: string;
  userId: string;
  rating: 'positive' | 'negative';
  comment: string | null;
  metadata: Record<string, unknown> | null;
  agentSlug: string | null;
  model: string | null;
  provider: string | null;
  createdAt: number;
}

const FOLD_COLUMNS = `
  id, thread_id AS "threadId", message_id AS "messageId",
  user_id AS "userId", rating, comment, metadata,
  agent_slug AS "agentSlug", model, provider,
  created_at_ms::float8 AS "createdAt"
`;

async function feedbackRowsSince(
  sql: Sql,
  organizationId: string,
  sinceMs: number | null,
  cap: number,
): Promise<FeedbackFoldRow[]> {
  return sql<FeedbackFoldRow[]>`
    SELECT ${sql.unsafe(FOLD_COLUMNS)} FROM app.message_feedback
    WHERE org_id = ${organizationId}
      AND lifecycle_status IS DISTINCT FROM 'trashed'
      AND (${sinceMs}::bigint IS NULL OR created_at_ms >= ${sinceMs})
    ORDER BY created_at_ms DESC
    LIMIT ${cap}
  `;
}

/** The 0.4 `getFeedbackStats`: the PURE reducer reused over pg rows. */
export async function getFeedbackStats(
  sql: Sql,
  organizationId: string,
  args: {
    periodDays?: 1 | 7 | 30 | 90;
    agentSlug?: string;
    model?: string;
    provider?: string;
  },
): Promise<Record<string, unknown>> {
  const { computeFeedbackStats } = await import('../../core/feedback/stats.ts');
  const now = Date.now();
  const cutoffMs =
    args.periodDays !== undefined ? now - args.periodDays * DAY_MS : null;
  const prevCutoffMs =
    cutoffMs !== null && args.periodDays !== undefined
      ? cutoffMs - args.periodDays * DAY_MS
      : null;
  const scanCutoffMs = prevCutoffMs ?? cutoffMs;

  const probe = await sql<{ id: string }[]>`
    SELECT id FROM app.message_feedback
    WHERE org_id = ${organizationId} LIMIT 1
  `;
  const hasAnyFeedback = probe.length > 0;

  const fetched = await feedbackRowsSince(
    sql,
    organizationId,
    scanCutoffMs,
    cutoffMs === null ? MAX_SCAN_ALL_TIME + 1 : 100_000,
  );
  const rows: FeedbackFoldRow[] = [];
  const prevRows: FeedbackFoldRow[] = [];
  for (const row of fetched) {
    if (cutoffMs === null || row.createdAt >= cutoffMs) rows.push(row);
    else prevRows.push(row);
    if (cutoffMs === null && rows.length > MAX_SCAN_ALL_TIME) break;
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reducer reads exactly the aliased fields (agentSlug/createdAt/metadata/model/provider/rating)
  const docRows = rows as unknown as Parameters<typeof computeFeedbackStats>[0];
  const stats = computeFeedbackStats(docRows, {
    cutoffMs,
    ...(args.agentSlug !== undefined ? { agentSlug: args.agentSlug } : {}),
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.provider !== undefined ? { provider: args.provider } : {}),
    maxScan: cutoffMs === null ? MAX_SCAN_ALL_TIME : Number.POSITIVE_INFINITY,
  });

  let previous:
    | { positive: number; negative: number; total: number }
    | undefined;
  if (prevCutoffMs !== null) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same aliased shape
    const prevDocRows = prevRows as unknown as Parameters<
      typeof computeFeedbackStats
    >[0];
    const prevStats = computeFeedbackStats(prevDocRows, {
      cutoffMs: prevCutoffMs,
      ...(args.agentSlug !== undefined ? { agentSlug: args.agentSlug } : {}),
      ...(args.model !== undefined ? { model: args.model } : {}),
      ...(args.provider !== undefined ? { provider: args.provider } : {}),
      maxScan: Number.POSITIVE_INFINITY,
    });
    previous = {
      positive: prevStats.message.byRating.positive,
      negative: prevStats.message.byRating.negative,
      total: prevStats.message.total,
    };
  }

  return { ...stats, hasAnyFeedback, ...(previous ? { previous } : {}) };
}

/** The 0.4 `listRecentFeedback` page (keyset; arena rows ride metadata). */
export async function listRecentFeedbackPage(
  sql: Sql,
  organizationId: string,
  args: {
    numItems: number;
    cursor: { ts: number; id: string } | null;
    periodDays?: 1 | 7 | 30 | 90;
    kind?: 'all' | 'message' | 'arena';
    withCommentOnly?: boolean;
    agentSlug?: string;
    model?: string;
    provider?: string;
  },
): Promise<{ page: unknown[]; isDone: boolean; continueCursor: string }> {
  const cutoffMs =
    args.periodDays !== undefined
      ? Date.now() - args.periodDays * DAY_MS
      : null;
  const limit = Math.min(Math.max(1, args.numItems), 100);
  const rows = await sql<FeedbackFoldRow[]>`
    SELECT ${sql.unsafe(FOLD_COLUMNS)} FROM app.message_feedback
    WHERE org_id = ${organizationId}
      AND lifecycle_status IS DISTINCT FROM 'trashed'
      AND (${cutoffMs}::bigint IS NULL OR created_at_ms >= ${cutoffMs})
      AND (${args.agentSlug ?? null}::text IS NULL OR agent_slug = ${args.agentSlug ?? null})
      AND (${args.model ?? null}::text IS NULL OR model = ${args.model ?? null})
      AND (${args.provider ?? null}::text IS NULL OR provider = ${args.provider ?? null})
      AND (${args.cursor?.ts ?? null}::bigint IS NULL
        OR (created_at_ms, id) < (${args.cursor?.ts ?? null}, ${args.cursor?.id ?? null}))
    ORDER BY created_at_ms DESC, id DESC
    LIMIT ${limit + 1}
  `;
  const pageRows = rows.slice(0, limit);
  const isDone = rows.length <= limit;

  // Post-filters mirror 0.4 (kind / withCommentOnly are page-level).
  const wanted = pageRows.filter((row) => {
    const isArena = row.metadata?.arenaVerdict !== undefined;
    if (args.kind === 'message' && isArena) return false;
    if (args.kind === 'arena' && !isArena) return false;
    if (args.withCommentOnly === true && !row.comment) return false;
    return true;
  });

  const userIds = [...new Set(wanted.map((row) => row.userId))];
  const users =
    userIds.length === 0
      ? []
      : await sql<{ id: string; name: string | null }[]>`
          SELECT "id", "name" FROM "user" WHERE "id" = ANY(${userIds})
        `;
  const nameOf = new Map(users.map((user) => [user.id, user.name] as const));

  const items = wanted.map((row) => {
    const verdictRaw = row.metadata?.arenaVerdict;
    const arenaVerdict =
      ARENA_VERDICTS.find((verdict) => verdict === verdictRaw) ?? null;
    const modelA = row.metadata?.modelA;
    const modelB = row.metadata?.modelB;
    return {
      _id: row.id,
      threadId: row.threadId,
      messageId: row.messageId,
      userId: row.userId,
      userDisplayName: nameOf.get(row.userId) ?? row.userId,
      rating: row.rating,
      comment: row.comment
        ? row.comment.length > COMMENT_PROJECTION_MAX
          ? row.comment.slice(0, COMMENT_PROJECTION_MAX) + '…'
          : row.comment
        : null,
      agentSlug: row.agentSlug,
      model: row.model,
      provider: row.provider,
      arenaVerdict,
      arenaModelA: typeof modelA === 'string' ? modelA : null,
      arenaModelB: typeof modelB === 'string' ? modelB : null,
      isArena: row.metadata?.arenaVerdict !== undefined,
      createdAt: row.createdAt,
    };
  });

  const last = pageRows.at(-1);
  return {
    page: items,
    isDone,
    continueCursor:
      isDone || last === undefined ? '' : `${last.createdAt}|${last.id}`,
  };
}
