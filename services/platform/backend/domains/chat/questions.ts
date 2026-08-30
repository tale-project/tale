import type { Sql, TransactionSql } from 'postgres';

import {
  questionSetSchema,
  type QuestionSet,
} from '../../../lib/shared/schemas/questions.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import { toJson } from '../../db/sql.ts';
import { loadOwnedThread } from './threads.ts';

/**
 * Pending clarifying questions for a chat thread — the 0.4
 * `chat/questions.ts` twins. The row lives on `app.approvals` as
 * `resource_type = 'human_input_request'` (one pending per thread; a new ask
 * supersedes the old), the ANSWER is the person's next ordinary message, and
 * the panel derives "still outstanding" from the thread itself: any user
 * message newer than the ask settles it, no close-write required.
 */
const RESOURCE_TYPE = 'human_input_request';

/** How far back the outcome stamp looks for the asking `human-input` part —
 * a pending question occupies the composer, so it is always among the
 * newest few messages. */
const ASK_SCAN_LIMIT = 20;

/**
 * Register a question set for a thread — the pipeline seam (the 0.4
 * `createQuestionRequestInternal`; the `ask_question` tool is still off the
 * wire, so nothing calls this yet — it completes the domain for the day the
 * tool lands). Supersedes any open row on the thread.
 */
export async function createQuestionRequest(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    threadId: string;
    messageId?: string;
    set: QuestionSet;
  },
): Promise<string> {
  const now = Date.now();
  await sql`
    UPDATE app.approvals
    SET status = 'rejected', reviewed_at_ms = ${now}
    WHERE thread_id = ${args.threadId} AND status = 'pending'
      AND resource_type = ${RESOURCE_TYPE}
      AND org_id = ${args.organizationId}
  `;
  const rows = await sql<{ id: string }[]>`
    INSERT INTO app.approvals (
      org_id, status, resource_type, resource_id, thread_id, message_id,
      priority, metadata, created_at_ms
    ) VALUES (
      ${args.organizationId}, 'pending', ${RESOURCE_TYPE}, ${args.threadId},
      ${args.threadId}, ${args.messageId ?? null}, 'medium',
      ${sql.json(toJson({ set: args.set, requestedAt: now }))}, ${now}
    )
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('question insert returned no row');
  return id;
}

/** The pending question set for a thread, or null. The composer watches
 * this — owner-only, like the 0.4 read (a project reader must not learn
 * what the owner was asked). */
export async function getPendingQuestion(
  sql: Sql,
  args: { organizationId: string; userId: string; threadId: string },
): Promise<{ requestId: string; set: QuestionSet } | null> {
  const owned = await loadOwnedThread(
    sql,
    args.organizationId,
    args.userId,
    args.threadId,
  );
  if (owned === null) return null;

  const rows = await sql<
    { id: string; metadata: unknown; createdAt: number }[]
  >`
    SELECT id, metadata, created_at_ms::float8 AS "createdAt"
    FROM app.approvals
    WHERE thread_id = ${args.threadId} AND status = 'pending'
      AND resource_type = ${RESOURCE_TYPE}
      AND org_id = ${args.organizationId}
    ORDER BY created_at_ms DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined) return null;

  // Outstanding only while the conversation has NOT moved past it: anything
  // the person said since — the answer, or a change of subject — settles it.
  const requestedAt =
    isRecord(row.metadata) && typeof row.metadata.requestedAt === 'number'
      ? row.metadata.requestedAt
      : row.createdAt;
  const movedOn = await sql<{ one: number }[]>`
    SELECT 1 AS one FROM app.messages
    WHERE thread_id = ${args.threadId} AND role = 'user'
      AND created_at_ms > ${requestedAt}
    LIMIT 1
  `;
  if (movedOn.length > 0) return null;

  const parsed = questionSetSchema.safeParse(
    isRecord(row.metadata) ? row.metadata.set : undefined,
  );
  if (!parsed.success) {
    console.warn(
      `[chat] pending question ${row.id} has an unreadable set; hiding it`,
    );
    return null;
  }
  return { requestId: row.id, set: parsed.data };
}

/**
 * Record on the transcript how the question ended — the part is the ask's
 * only lasting trace. Best-effort: a resolved question whose part could not
 * be found stays resolved; the row keeps its neutral badge.
 */
async function stampOutcome(
  sql: Sql,
  threadId: string,
  requestId: string,
  outcome: 'answered' | 'skipped',
): Promise<void> {
  const recent = await sql<{ id: string; parts: unknown }[]>`
    SELECT id, parts FROM app.messages
    WHERE thread_id = ${threadId}
    ORDER BY "order" DESC, step_order DESC
    LIMIT ${ASK_SCAN_LIMIT}
  `;
  for (const message of recent) {
    if (!Array.isArray(message.parts)) continue;
    let found = false;
    const parts = message.parts.map((part: unknown) => {
      if (
        isRecord(part) &&
        part.type === 'human-input' &&
        part.requestId === requestId
      ) {
        found = true;
        return { ...part, outcome };
      }
      return part;
    });
    if (found) {
      await sql`
        UPDATE app.messages SET parts = ${sql.json(toJson(parts))}
        WHERE id = ${message.id}
      `;
      return;
    }
  }
  console.warn(
    `[chat] no human-input part found for ${requestId}; transcript row keeps its neutral state`,
  );
}

/**
 * Close a pending question — `answered` when the person filled it in,
 * `superseded` when they said something else instead. A double-submit is a
 * no-op, never an error.
 */
export async function resolveQuestion(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    requestId: string;
    outcome: 'answered' | 'superseded';
  },
): Promise<null> {
  const rows = await sql<{ id: string; threadId: string | null }[]>`
    SELECT id, thread_id AS "threadId" FROM app.approvals
    WHERE id = ${args.requestId} AND org_id = ${args.organizationId}
      AND resource_type = ${RESOURCE_TYPE} AND status = 'pending'
    LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined || row.threadId === null) return null;
  const owned = await loadOwnedThread(
    sql,
    args.organizationId,
    args.userId,
    row.threadId,
  );
  if (owned === null) return null;

  await sql`
    UPDATE app.approvals
    SET status = ${args.outcome === 'answered' ? 'completed' : 'rejected'},
        approved_by = ${args.userId}, reviewed_at_ms = ${Date.now()}
    WHERE id = ${row.id} AND status = 'pending'
  `;
  await stampOutcome(
    sql,
    row.threadId,
    args.requestId,
    args.outcome === 'answered' ? 'answered' : 'skipped',
  );
  return null;
}
