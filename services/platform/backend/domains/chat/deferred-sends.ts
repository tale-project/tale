import type { Sql } from 'postgres';

import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { isBackendDraining } from '../control/service.ts';
import {
  bindJobsForDeferredSend,
  buildBoundJobAttachments,
  cancelDeferredJobs,
} from '../video_links/service.ts';
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
  /** Video-link jobs claimed for this send (the bind_for_send lane). */
  videoJobIds: string[];
}

const ROW_COLUMNS = `
  id, org_id AS "organizationId", user_id AS "userId",
  thread_id AS "threadId", user_text AS "userText", attachments,
  model_id AS "modelId", model_selection AS "modelSelection",
  provider_slug AS "providerSlug", reasoning_effort AS "reasoningEffort",
  locale, status, created_at_ms::float8 AS "createdAt",
  waiting_since_ms::float8 AS "waitingSince", video_job_ids AS "videoJobIds"
`;

function readVideoJobIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

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
  return {
    ...row,
    attachments: readAttachments(row.attachments),
    videoJobIds: readVideoJobIds(row.videoJobIds),
  };
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
    /** Video-link jobs to claim for this send (bind_for_send). */
    videoJobIds?: string[];
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
  if (
    trimmed.length === 0 &&
    (args.attachments?.length ?? 0) === 0 &&
    (args.videoJobIds?.length ?? 0) === 0
  ) {
    throw new ChatThreadError('EMPTY_MESSAGE', 'Nothing to send');
  }
  if (
    (args.attachments?.length ?? 0) + (args.videoJobIds?.length ?? 0) >
    MAX_ATTACHMENTS
  ) {
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
    // The per-send singletonKey (queue policy 'short') collapses the poll
    // self-chain to at most one queued hop, so the watchdog can blindly
    // re-enqueue a poll for a stalled row without doubling a live chain.
    await addJobInTx(
      tx,
      'chat.deferred_send_poll',
      { deferredSendId },
      { singletonKey: deferredSendId },
    );
    return { deferredSendId };
  });
}

/** The enqueue's video half, OUTSIDE the insert tx: claim the jobs, then
 * stamp the claimed set on the row (the claim releases the composer chips;
 * an unclaimable id — foreign, already bound, cancelled — is dropped, the
 * 0.4 posture). */
export async function claimDeferredSendVideos(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    threadId: string;
    deferredSendId: string;
    videoJobIds: readonly string[];
  },
): Promise<string[]> {
  const claimed = await bindJobsForDeferredSend(sql, {
    jobIds: args.videoJobIds,
    userId: args.userId,
    threadId: args.threadId,
    organizationId: args.organizationId,
  });
  if (claimed.length > 0) {
    await sql`
      UPDATE app.deferred_sends
      SET video_job_ids = ${claimed}
      WHERE id = ${args.deferredSendId} AND org_id = ${args.organizationId}
    `;
  }
  return claimed;
}

/** Abandon a waiting send. A `claimed` row is already running — too late,
 * refuse quietly. */
export async function cancelDeferredSend(
  sql: Sql,
  args: { organizationId: string; userId: string; deferredSendId: string },
): Promise<boolean> {
  const rows = await sql<{ id: string; videoJobIds: unknown }[]>`
    DELETE FROM app.deferred_sends
    WHERE id = ${args.deferredSendId} AND org_id = ${args.organizationId}
      AND user_id = ${args.userId} AND status = 'waiting'
    RETURNING id, video_job_ids AS "videoJobIds"
  `;
  const row = rows[0];
  if (!row) return false;
  // Cancelling the message cancels its claimed media too (the 0.4
  // `cancelDeferredJobs` cascade) — the videos must not keep processing.
  await cancelDeferredJobs(
    sql,
    args.organizationId,
    readVideoJobIds(row.videoJobIds),
    args.userId,
  );
  return true;
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
    videoJobIds: string[];
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
      videoJobIds: unknown;
      status: 'waiting' | 'claimed';
      createdAt: number;
    }[]
  >`
    SELECT id, user_text AS "userText", attachments, status,
           video_job_ids AS "videoJobIds",
           created_at_ms::float8 AS "createdAt"
    FROM app.deferred_sends
    WHERE thread_id = ${args.threadId}
    ORDER BY created_at_ms
  `;
  return rows.map((row) => ({
    deferredSendId: row.id,
    userText: row.userText,
    attachments: readAttachments(row.attachments),
    videoJobIds: readVideoJobIds(row.videoJobIds),
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
  // The video leg: a claimed job still ingesting/transcribing holds the
  // send; a terminal job (completed, failed, skipped — and the Whisper
  // handoff once its transcription settles) releases it. A VANISHED row
  // reads as "erased — proceed" (the 0.4 posture).
  for (const jobId of row.videoJobIds) {
    const jobs = await sql<
      { status: string; transcriptionStatus: string | null }[]
    >`
      SELECT j.status, m.transcription_status AS "transcriptionStatus"
      FROM app.video_link_jobs j
      LEFT JOIN app.file_metadata m ON m.id = j.file_metadata_id
      WHERE j.id = ${jobId} AND j.org_id = ${row.organizationId}
      LIMIT 1
    `;
    const job = jobs[0];
    if (!job) continue;
    if (job.status === 'completed' || job.status === 'failed') continue;
    if (job.status === 'skipped') continue;
    if (
      job.status === 'transcribing_handoff' &&
      job.transcriptionStatus !== null &&
      job.transcriptionStatus !== 'queued' &&
      job.transcriptionStatus !== 'running'
    ) {
      continue;
    }
    return false;
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
      {
        startAfter: new Date(Date.now() + delayMs),
        singletonKey: deferredSendId,
      },
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
    UPDATE app.deferred_sends
    SET status = 'claimed', waiting_since_ms = ${Date.now()}
    WHERE id = ${row.id} AND status = 'waiting'
    RETURNING id
  `;
  if (claimed.length === 0) return 'gone';

  try {
    // The claimed videos' transcripts join the send now (the 0.4
    // `buildBoundJobAttachments` semantics — a job without a completed
    // transcript is left out and the turn proceeds without it).
    const videoAttachments =
      row.videoJobIds.length > 0
        ? await buildBoundJobAttachments(
            sql,
            row.organizationId,
            row.videoJobIds,
          )
        : [];
    const attachments = [...row.attachments, ...videoAttachments];
    const outcome = await runChatTurn(sql, {
      organizationId: row.organizationId,
      userId: row.userId,
      threadId: row.threadId,
      userText: row.userText,
      ...(attachments.length > 0 ? { attachments } : {}),
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

/** A waiting row is re-polled once it is older than this — a floor to skip a
 * row whose first poll simply has not run yet (the re-enqueue is
 * singletonKey-deduped, so it never doubles a live chain). */
const WAITING_STALE_MS = 30 * 1000;
/** A claimed row whose turn never finished — the process died between the
 * claim and the finally-DELETE. Generous: a turn is quick. */
const CLAIMED_STALE_MS = 15 * 60 * 1000;

/**
 * Crash-recovery watchdog for parked sends (the job-liveness class), covering
 * both dead-ends the poll self-chain leaves behind:
 *
 *  - a WAITING row whose poll chain SEVERED (a hop threw, or a worker died
 *    mid-hop — the poll has retryLimit 0) sits forever with no error and no
 *    way to cancel. Re-enqueue its poll. The per-send singletonKey ('short'
 *    queue policy) means a row with a live chain is a no-op and only a dead
 *    chain is revived, so this never doubles the healthy fast-poll cadence.
 *  - a CLAIMED row wedged by a crash between the claim and the finally-DELETE
 *    is uncancellable (cancel needs 'waiting') and a permanent tray chip.
 *    Clear it. The chat-generation watchdog owns the thread's composer; this
 *    only removes the tray row. At-most-once LLM spend: the turn is never
 *    re-run (a crash surfaces through the generation watchdog, not a rerun).
 *
 * `waiting_since_ms` is stamped at both park and claim, so it dates the
 * CURRENT state for either arm.
 */
export async function recoverStuckDeferredSends(
  sql: Sql,
  options: { waitingStaleMs?: number; claimedStaleMs?: number } = {},
): Promise<{ repolled: number; cleared: number }> {
  const now = Date.now();
  const waitingCutoff = now - (options.waitingStaleMs ?? WAITING_STALE_MS);
  const claimedCutoff = now - (options.claimedStaleMs ?? CLAIMED_STALE_MS);
  const waiting = await sql<{ id: string }[]>`
    SELECT id FROM app.deferred_sends
    WHERE status = 'waiting' AND waiting_since_ms < ${waitingCutoff}
    ORDER BY waiting_since_ms
    LIMIT 200
  `;
  let repolled = 0;
  for (const row of waiting) {
    await addJobInTx(
      sql,
      'chat.deferred_send_poll',
      { deferredSendId: row.id },
      { singletonKey: row.id },
    );
    repolled += 1;
  }
  const cleared = await sql<{ id: string }[]>`
    DELETE FROM app.deferred_sends
    WHERE status = 'claimed' AND waiting_since_ms < ${claimedCutoff}
    RETURNING id
  `;
  if (repolled > 0 || cleared.length > 0) {
    console.warn(
      `[deferred-send-watchdog] re-polled ${repolled} waiting, cleared ${cleared.length} wedged claimed`,
    );
  }
  return { repolled, cleared: cleared.length };
}
