import type { Sql, TransactionSql } from 'postgres';

import { toJson } from '../../db/sql.ts';

/**
 * The message store — the 0.5 replacement for the `@convex-dev/agent`
 * component's thread/message tables. Deliberately surface-minimal: threads,
 * ordered messages ((order, step_order) exactly like the component), and the
 * tail read the task/project discussions need; the chat engine keeps its own
 * readers in `domains/chat/`. The store persists only settled messages.
 */

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
 * How long an appender keeps re-claiming the next (order, step) slot while
 * concurrent appends take the ones it computes. The slot is UNIQUE
 * (`messages_thread_slot`), so a lost race is refused at the index rather
 * than landing two rows on one slot; under READ COMMITTED each claim is a
 * fresh statement that sees the winner's row. Every round has at least one
 * winner among the appenders racing for a thread (exactly one when they run
 * in lockstep), so a burst of N appenders lands within N rounds — which is
 * why the budget is wall-clock and never a count: a count is defeated by any
 * burst larger than itself. Under
 * SERIALIZABLE the same conflict surfaces as a serialization failure and
 * `transactSerializable` reruns the whole transaction instead, so the loop
 * never spins there.
 */
export const MESSAGE_SLOT_CLAIM_DEADLINE_MS = 10_000;

/**
 * The longest pause between two claims of one appender: enough to break the
 * lockstep, small enough that the last member of a large burst waits well
 * under a second in total.
 */
const MESSAGE_SLOT_BACKOFF_CAP_MS = 20;

export interface SlotClaimOptions {
  /** Wall-clock budget for the whole claim; the default is the constant above. */
  deadlineMs?: number;
  /** Clock and sleep, injectable so tests exhaust the budget deterministically. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Jittered exponential pause after the `attempt`-th lost race (1 ms, 2 ms,
 * 4 ms … capped at {@link MESSAGE_SLOT_BACKOFF_CAP_MS}): the losers of one
 * round must not re-collide in lockstep.
 */
function slotBackoffMs(attempt: number): number {
  const base = Math.min(MESSAGE_SLOT_BACKOFF_CAP_MS, 2 ** (attempt - 1));
  return base * (0.5 + Math.random());
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `claim` — one `INSERT … ON CONFLICT DO NOTHING RETURNING` — until it
 * lands a row (`undefined` = the computed slot went to a concurrent append).
 * Gives up only when {@link SlotClaimOptions.deadlineMs} is spent, naming the
 * budget and the rounds it took; nothing else is written meanwhile.
 */
export async function claimMessageSlot<T>(
  claim: () => Promise<T | undefined>,
  options: SlotClaimOptions = {},
): Promise<T> {
  const deadlineMs = options.deadlineMs ?? MESSAGE_SLOT_CLAIM_DEADLINE_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = now() + deadlineMs;
  for (let attempt = 1; ; attempt += 1) {
    const row = await claim();
    if (row !== undefined) {
      return row;
    }
    if (now() >= deadline) {
      throw new Error(
        `message insert failed: no free slot within ${deadlineMs} ms (${attempt} attempts)`,
      );
    }
    await sleep(slotBackoffMs(attempt));
  }
}

/**
 * Append a message as the next turn: claims `max(order)+1` with
 * `step_order = 0` in ONE statement (read and write together), and re-claims
 * the following slot when a concurrent append took it first. Runs inside the
 * caller's transaction; under a serializable one, two concurrent appends to
 * one thread serialize (one retries the transaction).
 */
export async function saveMessage(
  tx: TransactionSql,
  args: SaveMessageArgs,
  slot: SlotClaimOptions = {},
): Promise<{ messageId: string; order: number }> {
  const row = await claimMessageSlot(async () => {
    const rows = await tx<{ id: string; order: number }[]>`
      INSERT INTO app.messages (
        thread_id, org_id, "order", step_order, role, parts, text, author_id,
        status, created_at_ms
      )
      SELECT ${args.threadId}, ${args.organizationId},
             coalesce(max("order"), -1) + 1, 0, ${args.role},
             ${args.parts === undefined ? null : tx.json(toJson(args.parts))},
             ${args.text ?? null}, ${args.authorId ?? null},
             ${args.status ?? 'complete'}, ${Date.now()}
      FROM app.messages WHERE thread_id = ${args.threadId}
      ON CONFLICT (thread_id, "order", step_order) DO NOTHING
      RETURNING id, "order"
    `;
    return rows[0]; // undefined: the slot went to a concurrent append
  }, slot);
  await tx`
    UPDATE app.threads SET updated_at_ms = ${Date.now()}
    WHERE id = ${args.threadId}
  `;
  return { messageId: row.id, order: row.order };
}

/** The most messages one read may ask for, on either lane below. */
export const THREAD_MESSAGES_READ_MAX = 500;

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
