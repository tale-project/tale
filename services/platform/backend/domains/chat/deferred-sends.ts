import type { Sql } from 'postgres';

import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { isBackendDraining } from '../control/service.ts';
import { runChatTurn } from './service.ts';
import { ChatThreadError, loadOwnedThread } from './threads.ts';

/**
 * Send-then-wait for attachments — the 0.5 twin of
 * `convex/chat/deferred_sends.ts`. Clicking Send while a staged document
 * still RAG-indexes or a clip still transcribes parks the send as a
 * `deferred_sends` row; the readiness poller (a self-chaining pg-boss job
 * replacing 0.4's scheduler chain) starts the turn server-side — under the
 * row's stored identity — the moment every tracked medium is terminal and
 * the thread is idle.
 *
 * Readiness matrix (the 0.4 one): document uploads wait on `rag_status`
 * out of queued|running; A/V uploads on `transcription_status` likewise
 * (failed/skipped proceed degraded); images never gate. Video-link jobs
 * ride the video-links domain — absent rows read as "erased — proceed".
 */

const READY_POLL_MS = 3_000;
const SLOW_POLL_MS = 15_000;
/** After two minutes, back the poll off — a long transcription or a
 * failed-chip stall should not burn a poll every 3s for hours. */
const SLOW_AFTER_MS = 2 * 60_000;
/** Waiting + claimed rows per thread. A bound, not a quota. */
const MAX_DEFERRED_PER_THREAD = 10;
const MAX_ATTACHMENTS = 20;

export interface DeferredAttachment {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

export interface DeferredSendRow {
  id: string;
  organizationId: string;
  userId: string;
  threadId: string;
  userText: string;
  attachments: DeferredAttachment[];
  modelId: string | null;
  modelSelection: string | null;
  providerSlug: string | null;
  reasoningEffort: string | null;
  locale: string;
  status: 'waiting' | 'claimed';
  createdAt: number;
  waitingSince: number;
}

const ROW_COLUMNS = `
  id, org_id AS "organizationId", user_id AS "userId",
  thread_id AS "threadId", user_text AS "userText", attachments,
  model_id AS "modelId", model_selection AS "modelSelection",
  provider_slug AS "providerSlug", reasoning_effort AS "reasoningEffort",
  locale, status, created_at_ms::float8 AS "createdAt",
  waiting_since_ms::float8 AS "waitingSince"
`;

function readAttachments(value: unknown): DeferredAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: DeferredAttachment[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed to object; typeof guards gate every field read
    const record = entry as Record<string, unknown>;
    if (
      typeof record.fileId === 'string' &&
      typeof record.fileName === 'string' &&
      typeof record.fileType === 'string' &&
      typeof record.fileSize === 'number'
    ) {
      out.push({
        fileId: record.fileId,
        fileName: record.fileName,
        fileType: record.fileType,
        fileSize: record.fileSize,
      });
    }
  }
  return out;
}

async function loadRow(
  sql: Sql,
  deferredSendId: string,
): Promise<DeferredSendRow | null> {
  const rows = await sql<
    (Omit<DeferredSendRow, 'attachments'> & { attachments: unknown })[]
  >`
    SELECT ${sql.unsafe(ROW_COLUMNS)} FROM app.deferred_sends
    WHERE id = ${deferredSendId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { ...row, attachments: readAttachments(row.attachments) };
}

/** Park a send; the poller job rides the insert's transaction. */
export async function enqueueDeferredSend(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    threadId: string;
    userText: string;
    attachments?: DeferredAttachment[];
    modelId?: string;
    modelSelection?: 'auto';
    providerSlug?: string;
    reasoningEffort?: string;
    locale?: string;
  },
): Promise<{ deferredSendId: string }> {
  if ((args.modelId === undefined) === (args.modelSelection === undefined)) {
    throw new ChatThreadError('MODEL_REQUIRED', 'Pass a model id or Auto');
  }
  const thread = await loadOwnedThread(
    sql,
    args.organizationId,
    args.userId,
    args.threadId,
  );
  if (thread === null) {
    throw new ChatThreadError('THREAD_NOT_FOUND', 'Thread not found', 404);
  }
  const trimmed = args.userText.trim();
  if (trimmed.length === 0 && (args.attachments?.length ?? 0) === 0) {
    throw new ChatThreadError('EMPTY_MESSAGE', 'Nothing to send');
  }
  if ((args.attachments?.length ?? 0) > MAX_ATTACHMENTS) {
    throw new ChatThreadError('TOO_MANY_ATTACHMENTS', 'Too many attachments');
  }
  return sql.begin(async (tx) => {
    const pending = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.deferred_sends
      WHERE thread_id = ${args.threadId}
    `;
    if (Number(pending[0]?.count ?? '0') >= MAX_DEFERRED_PER_THREAD) {
      throw new ChatThreadError('QUEUE_FULL', 'Too many parked sends', 409);
    }
    const now = Date.now();
    const rows = await tx<{ id: string }[]>`
      INSERT INTO app.deferred_sends (
        org_id, user_id, thread_id, user_text, attachments, model_id,
        model_selection, provider_slug, reasoning_effort, locale, status,
        created_at_ms, waiting_since_ms
      ) VALUES (
        ${args.organizationId}, ${args.userId}, ${args.threadId}, ${trimmed},
        ${
          args.attachments !== undefined && args.attachments.length > 0
            ? tx.json(toJson(args.attachments))
            : null
        },
        ${args.modelId ?? null}, ${args.modelSelection ?? null},
        ${args.providerSlug ?? null}, ${args.reasoningEffort ?? null},
        ${args.locale ?? 'en'}, 'waiting', ${now}, ${now}
      ) RETURNING id
    `;
    const deferredSendId = rows[0]?.id;
    if (!deferredSendId) throw new Error('deferred send insert failed');
    await addJobInTx(tx, 'chat.deferred_send_poll', { deferredSendId });
    return { deferredSendId };
  });
}

/** Abandon a waiting send. A `claimed` row is already running — too late,
 * refuse quietly. */
export async function cancelDeferredSend(
  sql: Sql,
  args: { organizationId: string; userId: string; deferredSendId: string },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM app.deferred_sends
    WHERE id = ${args.deferredSendId} AND org_id = ${args.organizationId}
      AND user_id = ${args.userId} AND status = 'waiting'
    RETURNING id
  `;
  return rows.length > 0;
}

/** The thread's parked sends, oldest first — the tray above the composer. */
export async function listDeferredSends(
  sql: Sql,
  args: { organizationId: string; userId: string; threadId: string },
): Promise<
  Array<{
    deferredSendId: string;
    userText: string;
    attachments: DeferredAttachment[];
    status: 'waiting' | 'claimed';
    createdAt: number;
  }>
> {
  const thread = await loadOwnedThread(
    sql,
    args.organizationId,
    args.userId,
    args.threadId,
  );
  if (thread === null) return [];
  const rows = await sql<
    {
      id: string;
      userText: string;
      attachments: unknown;
      status: 'waiting' | 'claimed';
      createdAt: number;
    }[]
  >`
    SELECT id, user_text AS "userText", attachments, status,
           created_at_ms::float8 AS "createdAt"
    FROM app.deferred_sends
    WHERE thread_id = ${args.threadId}
    ORDER BY created_at_ms
  `;
  return rows.map((row) => ({
    deferredSendId: row.id,
    userText: row.userText,
    attachments: readAttachments(row.attachments),
    status: row.status,
    createdAt: row.createdAt,
  }));
}

/** Readiness per the module-doc matrix. Exported for the integration run. */
export async function isDeferredSendReady(
  sql: Sql,
  row: DeferredSendRow,
): Promise<boolean> {
  for (const attachment of row.attachments) {
    if (attachment.fileType.startsWith('image/')) continue;
    const metas = await sql<
      { transcriptionStatus: string | null; ragStatus: string | null }[]
    >`
      SELECT transcription_status AS "transcriptionStatus",
             rag_status AS "ragStatus"
      FROM app.file_metadata
      WHERE storage_ref = ${attachment.fileId}
      ORDER BY created_at_ms DESC
      LIMIT 1
    `;
    const meta = metas[0];
    if (!meta) continue; // no pipeline record — nothing to wait on
    if (
      meta.transcriptionStatus === 'queued' ||
      meta.transcriptionStatus === 'running'
    ) {
      return false;
    }
    if (meta.ragStatus === 'queued' || meta.ragStatus === 'running') {
      return false;
    }
  }
  return true;
}

/**
 * One poll step: not ready (or the thread busy) → re-enqueue with the aged
 * backoff; ready + idle → claim and run the turn under the stored identity,
 * settling (deleting) the row in a `finally` — the 0.4 mop-up posture. A
 * deleted row (user cancelled) ends the chain silently. Returns what it did
 * for the integration run's observability.
 */
export async function pollDeferredSend(
  sql: Sql,
  deferredSendId: string,
): Promise<'gone' | 'waiting' | 'busy' | 'ran'> {
  const row = await loadRow(sql, deferredSendId);
  if (!row || row.status !== 'waiting') return 'gone';

  const reschedule = async (delayMs: number): Promise<void> => {
    await addJobInTx(
      sql,
      'chat.deferred_send_poll',
      { deferredSendId },
      { startAfter: new Date(Date.now() + delayMs) },
    );
  };

  if (!(await isDeferredSendReady(sql, row))) {
    const age = Date.now() - row.waitingSince;
    await reschedule(age > SLOW_AFTER_MS ? SLOW_POLL_MS : READY_POLL_MS);
    return 'waiting';
  }

  // Deploy drain: keep the parked send parked — it claims after the
  // restart instead of failing into a bubble the user must retry.
  if (await isBackendDraining(sql)) {
    await reschedule(READY_POLL_MS);
    return 'waiting';
  }
  // One turn per thread: while a generation row exists, wait our turn.
  const generating = await sql<{ threadId: string }[]>`
    SELECT thread_id AS "threadId" FROM app.generations
    WHERE thread_id = ${row.threadId} LIMIT 1
  `;
  if (generating.length > 0) {
    await reschedule(READY_POLL_MS);
    return 'busy';
  }

  const claimed = await sql<{ id: string }[]>`
    UPDATE app.deferred_sends SET status = 'claimed'
    WHERE id = ${row.id} AND status = 'waiting'
    RETURNING id
  `;
  if (claimed.length === 0) return 'gone';

  try {
    const outcome = await runChatTurn(sql, {
      organizationId: row.organizationId,
      userId: row.userId,
      threadId: row.threadId,
      userText: row.userText,
      ...(row.attachments.length > 0 ? { attachments: row.attachments } : {}),
      ...(row.modelId !== null ? { modelId: row.modelId } : {}),
      ...(row.modelSelection === 'auto'
        ? { modelSelection: 'auto' as const }
        : {}),
      ...(row.providerSlug !== null ? { providerSlug: row.providerSlug } : {}),
      ...(row.reasoningEffort !== null
        ? {
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the column CHECK admits exactly the effort union
            reasoningEffort: row.reasoningEffort as never,
          }
        : {}),
      locale: row.locale,
    });
    if (outcome.status === 'refused') {
      console.warn(
        `[deferred-send] turn refused for ${row.id}: ${outcome.reason}`,
      );
    }
  } finally {
    // The terminal mop-up: the row settles whether the turn completed,
    // refused, or threw — the thread shows the bubble (or nothing), and the
    // tray row would only double-display or wedge.
    await sql`DELETE FROM app.deferred_sends WHERE id = ${row.id}`;
  }
  return 'ran';
}
