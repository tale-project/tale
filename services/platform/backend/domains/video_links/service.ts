import type { Sql, TransactionSql } from 'postgres';

import { CHAT_AUDIO_MAX_DURATION_SEC } from '../../../lib/shared/file-types.ts';
import {
  isPlaylistUrl,
  detectPlatform,
  normalizeUrlForHash,
} from '../../../lib/shared/video-url.ts';
import { getUserTeamIds } from '../../auth/membership.ts';
import { ingestVideoLinkImpl } from '../../core/video_links/ingest_video_link.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  createCtxShim,
  type ShimHandlers,
  type ShimScheduler,
} from '../../lib/ctx-shim.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  claimBrowserSession,
  reportBrowserSessionResult,
} from '../browser_sessions/service.ts';
import { chatShimHandlers } from '../chat/shim.ts';
import { deleteOrgBlobRefs, putOrgBlobBytes } from '../files/service.ts';
import { markRagQueued } from '../knowledge/service.ts';
import { checkTtsBudget } from '../tts/service.ts';

/**
 * Video links — the 0.5 twin of `convex/video_links`: paste a video URL in
 * the chat composer, the REUSED orchestrator (`ingest_video_link.ts`,
 * hoisted) fetches metadata via yt-dlp, prefers platform captions
 * (fidelity-first language ladder), falls back to audio extraction +
 * the Whisper pipeline (inc 68's `files.transcribe`), and lands a
 * synthetic `file_metadata` transcript row that binds to the outgoing
 * message. Donor reuse clones an org-local transcript for a re-pasted
 * URL without touching yt-dlp. The engine's ctx runs on this service's
 * verbs + the chat shim; its retry self-chain maps onto `video.ingest`
 * jobs and the 0.4 stuck-row cron onto the `video.watchdog` schedule.
 *
 * Browser-session pooling backs the claim/report verbs — an empty pool
 * answers null and the ingest proceeds without a session (the 0.4 path).
 */

export class VideoLinkError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409 | 429;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 | 429 = 400,
  ) {
    super(message);
    this.name = 'VideoLinkError';
    this.code = code;
    this.status = status;
  }
}

const MAX_IN_FLIGHT_PER_ORG = 3;
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const RETRY_COOLDOWN_MS = 15 * 60_000;
export const TRANSCRIPT_REUSE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DONOR_SCAN_LIMIT = 20;

const NON_TERMINAL_STATUSES = [
  'queued',
  'fetching_metadata',
  'fetching_captions',
  'extracting_audio',
  'transcribing_handoff',
  'indexing',
] as const;

function isNonTerminalStatus(status: string): boolean {
  return (NON_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** FNV-1a double-pass, hex — the 0.4 dedup key (stable, non-crypto). */
export function hashUrlForDedup(normalized: string): string {
  const fnv = (seed: number, str: string): number => {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  };
  const a = fnv(0x811c9dc5, normalized).toString(16).padStart(8, '0');
  const b = fnv(0x9dc58117, normalized).toString(16).padStart(8, '0');
  return (a + b).slice(0, 16);
}

// ---------------------------------------------------------------------- rows

export interface VideoLinkJobRow {
  id: string;
  organizationId: string;
  threadId: string | null;
  uploadedBy: string;
  sourceUrl: string;
  sourceUrlHash: string;
  sourcePlatform: string;
  pastedToken: string;
  videoTitle: string | null;
  videoUploader: string | null;
  videoDurationSec: number | null;
  videoLanguage: string | null;
  videoChapters: unknown;
  transcriptSource: string | null;
  captionTrackKind: string | null;
  captionLang: string | null;
  status: string;
  statusChangedAt: number;
  progress: string | null;
  attempts: number | null;
  errorReasonCode: string | null;
  errorMessage: string | null;
  storageRef: string | null;
  fileMetadataId: string | null;
  lifecycleStatus: string | null;
  messageBoundAt: number | null;
  createdAt: number;
}

const JOB_COLUMNS = `
  id, org_id AS "organizationId", thread_id AS "threadId",
  uploaded_by AS "uploadedBy", source_url AS "sourceUrl",
  source_url_hash AS "sourceUrlHash", source_platform AS "sourcePlatform",
  pasted_token AS "pastedToken", video_title AS "videoTitle",
  video_uploader AS "videoUploader",
  video_duration_sec AS "videoDurationSec",
  video_language AS "videoLanguage", video_chapters AS "videoChapters",
  transcript_source AS "transcriptSource",
  caption_track_kind AS "captionTrackKind", caption_lang AS "captionLang",
  status, status_changed_at_ms::float8 AS "statusChangedAt", progress,
  attempts, error_reason_code AS "errorReasonCode",
  error_message AS "errorMessage", storage_ref AS "storageRef",
  file_metadata_id AS "fileMetadataId",
  lifecycle_status AS "lifecycleStatus",
  message_bound_at_ms::float8 AS "messageBoundAt",
  created_at_ms::float8 AS "createdAt"
`;

export async function getJob(
  db: Sql | TransactionSql,
  jobId: string,
): Promise<VideoLinkJobRow | null> {
  const rows = await db<VideoLinkJobRow[]>`
    SELECT ${db.unsafe(JOB_COLUMNS)} FROM app.video_link_jobs
    WHERE id = ${jobId} LIMIT 1
  `;
  return rows[0] ?? null;
}

export type UpdateJobResult = 'ok' | 'cas_miss' | 'not_found';

/**
 * Patch job fields (the 0.4 `updateJob` twin): a `status` write always
 * stamps `status_changed_at_ms` (the watchdog's staleness clock), and the
 * optional `expectedStatus` CAS turns racing instances into silent no-ops.
 */
export async function updateJob(
  db: Sql | TransactionSql,
  args: {
    jobId: string;
    status?: string;
    expectedStatus?: string;
    progress?: string | null;
    videoTitle?: string;
    videoUploader?: string;
    videoDurationSec?: number;
    videoLanguage?: string;
    videoChapters?: unknown[];
    transcriptSource?: string;
    captionTrackKind?: string;
    captionLang?: string;
    storageRef?: string;
    fileMetadataId?: string;
    errorReasonCode?: string | null;
    errorMessage?: string | null;
    attempts?: number;
    messageBoundAt?: number | null;
  },
): Promise<UpdateJobResult> {
  const now = Date.now();
  const rows = await db<{ id: string }[]>`
    UPDATE app.video_link_jobs SET
      status = ${args.status !== undefined ? args.status : db.unsafe('status')},
      status_changed_at_ms = ${args.status !== undefined ? now : db.unsafe('status_changed_at_ms')},
      progress = ${args.progress !== undefined ? args.progress : db.unsafe('progress')},
      video_title = ${args.videoTitle !== undefined ? args.videoTitle : db.unsafe('video_title')},
      video_uploader = ${args.videoUploader !== undefined ? args.videoUploader : db.unsafe('video_uploader')},
      video_duration_sec = ${args.videoDurationSec !== undefined ? args.videoDurationSec : db.unsafe('video_duration_sec')},
      video_language = ${args.videoLanguage !== undefined ? args.videoLanguage : db.unsafe('video_language')},
      video_chapters = ${args.videoChapters !== undefined ? db.json(toJson(args.videoChapters)) : db.unsafe('video_chapters')},
      transcript_source = ${args.transcriptSource !== undefined ? args.transcriptSource : db.unsafe('transcript_source')},
      caption_track_kind = ${args.captionTrackKind !== undefined ? args.captionTrackKind : db.unsafe('caption_track_kind')},
      caption_lang = ${args.captionLang !== undefined ? args.captionLang : db.unsafe('caption_lang')},
      storage_ref = ${args.storageRef !== undefined ? args.storageRef : db.unsafe('storage_ref')},
      file_metadata_id = ${args.fileMetadataId !== undefined ? args.fileMetadataId : db.unsafe('file_metadata_id')},
      error_reason_code = ${args.errorReasonCode !== undefined ? args.errorReasonCode : db.unsafe('error_reason_code')},
      error_message = ${args.errorMessage !== undefined ? args.errorMessage : db.unsafe('error_message')},
      attempts = ${args.attempts !== undefined ? args.attempts : db.unsafe('attempts')},
      message_bound_at_ms = ${args.messageBoundAt !== undefined ? args.messageBoundAt : db.unsafe('message_bound_at_ms')}
    WHERE id = ${args.jobId}
      AND (${args.expectedStatus ?? null}::text IS NULL
           OR status = ${args.expectedStatus ?? null})
    RETURNING id
  `;
  if (rows.length > 0) return 'ok';
  const exists = await db<{ id: string }[]>`
    SELECT id FROM app.video_link_jobs WHERE id = ${args.jobId} LIMIT 1
  `;
  return exists.length > 0 ? 'cas_miss' : 'not_found';
}

// -------------------------------------------------------------- lifecycle

/**
 * Cancellation/retry cleanup (the 0.4 twin): message-bound rows are
 * UNTOUCHABLE (their transcript is a sent bubble's content of record);
 * otherwise the blob deletes best-effort and a non-completed
 * file_metadata row drops.
 */
export async function cleanupCancelledVideoLink(
  sql: Sql,
  jobId: string,
): Promise<void> {
  const job = await getJob(sql, jobId);
  if (!job) return;
  if (job.messageBoundAt !== null) return;
  if (job.storageRef !== null) {
    await deleteOrgBlobRefs(sql, job.organizationId, [job.storageRef]);
  }
  if (job.fileMetadataId !== null) {
    await sql`
      DELETE FROM app.file_metadata
      WHERE id = ${job.fileMetadataId}
        AND transcription_status IS DISTINCT FROM 'completed'
    `;
  }
}

/**
 * Thrown inside a finalizer transaction when the job is no longer where the
 * finalizer left it (`indexing`): a cancel, a watchdog flip or a retry moved
 * it while the transcript was being stored. The throw rolls the file row and
 * the RAG job back with it — nothing may outlive the state that changed.
 */
class FinalizerStateLostError extends Error {
  constructor(jobId: string, outcome: UpdateJobResult) {
    super(
      `[video_links] job ${jobId} left 'indexing' before its finalizer landed (${outcome})`,
    );
    this.name = 'FinalizerStateLostError';
  }
}

/**
 * Both finalizers' terminal step: the synthetic file row + RAG enqueue
 * (`insertRow`) and the job's `indexing → completed` patch ride ONE
 * transaction, and the patch is a CAS on `indexing`. Without it a cancel
 * landing during the seconds-wide transcript store (its `skipped` write and
 * blob delete already done) was overwritten `completed`: the chip came back
 * Ready over a file row whose bytes were just deleted, and its RAG index
 * then failed. A lost CAS rolls everything back and reaps the orphan blob;
 * the caller's `null` means "nothing landed", exactly as a vanished job.
 */
async function finalizeVideoLinkFile(
  sql: Sql,
  args: { jobId: string; storageId: string; organizationId: string },
  insertRow: (tx: TransactionSql) => Promise<string>,
): Promise<string | null> {
  try {
    return await sql.begin(async (tx) => {
      const fileMetadataId = await insertRow(tx);
      await markRagQueued(tx, fileMetadataId);
      await addJobInTx(tx, 'rag.index_file', { fileId: fileMetadataId });
      const patched = await updateJob(tx, {
        jobId: args.jobId,
        fileMetadataId,
        storageRef: args.storageId,
        status: 'completed',
        expectedStatus: 'indexing',
        progress: null,
      });
      if (patched !== 'ok') {
        throw new FinalizerStateLostError(args.jobId, patched);
      }
      return fileMetadataId;
    });
  } catch (error) {
    if (!(error instanceof FinalizerStateLostError)) throw error;
    console.warn(error.message);
    await deleteOrgBlobRefs(sql, args.organizationId, [args.storageId]);
    return null;
  }
}

/**
 * The captions-branch finalizer (the 0.4 `insertSyntheticFileMetadata`):
 * provenance header + synthetic transcript row (source `video_link`,
 * dual RAG statuses) + RAG enqueue + terminal job patch. Bails (and reaps
 * the orphan blob) when the job row vanished or left `indexing` mid-flight
 * — the terminal patch is CAS'd, so a cancel is never undone.
 */
export async function insertSyntheticFileMetadata(
  sql: Sql,
  args: {
    jobId: string;
    storageId: string;
    transcript: string;
    fileSize: number;
    videoTitle: string;
    videoUploader?: string;
    videoDurationSec: number;
    sourceUrl: string;
    sourcePlatform: string;
    transcriptSource: string;
    captionLang?: string;
    threadId?: string;
    organizationId: string;
    uploadedBy: string;
  },
): Promise<string | null> {
  const job = await getJob(sql, args.jobId);
  if (!job || job.status !== 'indexing') {
    await deleteOrgBlobRefs(sql, args.organizationId, [args.storageId]);
    return null;
  }

  const provenanceHeader = [
    `Source: ${args.sourceUrl}`,
    `Platform: ${args.sourcePlatform}`,
    args.videoUploader ? `Uploader: ${args.videoUploader}` : null,
    `Fetched: ${new Date().toISOString()}`,
    `Method: ${args.transcriptSource}${args.captionLang ? ` (lang=${args.captionLang})` : ''}`,
  ]
    .filter(Boolean)
    .join('\n');
  const transcriptWithHeader = `${provenanceHeader}\n\n${args.transcript}`;

  return finalizeVideoLinkFile(sql, args, async (tx) => {
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO app.file_metadata (
        org_id, storage_ref, source, file_name, content_type, size,
        uploaded_by, thread_id, transcript, transcription_status,
        transcription_duration_sec, transcript_rag_status, rag_status,
        created_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.storageId}, 'video_link',
        ${`${args.videoTitle}.txt`}, 'text/plain; charset=utf-8',
        ${args.fileSize}, ${args.uploadedBy}, ${args.threadId ?? null},
        ${transcriptWithHeader}, 'completed', ${args.videoDurationSec},
        'queued', 'queued', ${Date.now()}
      )
      RETURNING id
    `;
    const fileMetadataId = inserted[0]?.id;
    if (!fileMetadataId) throw new Error('synthetic file insert failed');
    return fileMetadataId;
  });
}

/** The donor-clone finalizer (the 0.4 twin): transcript stored VERBATIM
 * (the donor text already carries its provenance header), CAS on
 * status='indexing' inside the transaction — a raced cancel reaps the blob
 * and writes nothing. */
export async function finalizeClonedTranscript(
  sql: Sql,
  args: {
    jobId: string;
    storageId: string;
    organizationId: string;
    transcript: string;
    fileName: string;
    fileSize: number;
    transcriptionDurationSec?: number;
  },
): Promise<string | null> {
  const job = await getJob(sql, args.jobId);
  if (!job || job.status !== 'indexing') {
    await deleteOrgBlobRefs(sql, args.organizationId, [args.storageId]);
    return null;
  }
  return finalizeVideoLinkFile(sql, args, async (tx) => {
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO app.file_metadata (
        org_id, storage_ref, source, file_name, content_type, size,
        uploaded_by, thread_id, transcript, transcription_status,
        transcription_duration_sec, transcript_rag_status, rag_status,
        created_at_ms
      ) VALUES (
        ${job.organizationId}, ${args.storageId}, 'video_link',
        ${args.fileName}, 'text/plain; charset=utf-8', ${args.fileSize},
        ${job.uploadedBy}, ${job.threadId},
        ${args.transcript}, 'completed',
        ${args.transcriptionDurationSec ?? null}, 'queued', 'queued',
        ${Date.now()}
      )
      RETURNING id
    `;
    const fileMetadataId = inserted[0]?.id;
    if (!fileMetadataId) throw new Error('clone file insert failed');
    return fileMetadataId;
  });
}

/** Per-chunk Whisper heartbeat (the 0.4 twin) — advances the watchdog
 * clock of a `transcribing_handoff` job tracking this blob. */
export async function heartbeatJobByStorageRef(
  sql: Sql,
  args: { storageId: string; progress?: string },
): Promise<void> {
  await sql`
    UPDATE app.video_link_jobs SET
      status_changed_at_ms = ${Date.now()},
      progress = ${args.progress !== undefined ? args.progress : sql.unsafe('progress')}
    WHERE storage_ref = ${args.storageId}
      AND status = 'transcribing_handoff'
  `;
}

/**
 * The handoff's missing terminal transition: when the transcription lane
 * settles the file row for this blob, drive the video-link job that handed
 * off to it to the SAME terminal state. Without this write the job sits in
 * `transcribing_handoff` forever — `countInFlight` keeps charging the org's
 * ingest cap for finished work, the GC never reaps it, and retry 409s.
 * The transcription seam calls this in the SAME transaction as the file
 * row's terminal write, so chip state and slot accounting cannot diverge.
 */
export async function settleHandoffJobsByStorageRef(
  db: Sql | TransactionSql,
  args: {
    storageId: string;
    transcriptionStatus: 'completed' | 'failed' | 'skipped';
    errorMessage?: string;
  },
): Promise<void> {
  const now = Date.now();
  if (args.transcriptionStatus === 'failed') {
    await db`
      UPDATE app.video_link_jobs SET
        status = 'failed',
        status_changed_at_ms = ${now},
        progress = NULL,
        error_reason_code = 'whisperFailed',
        error_message = ${args.errorMessage ?? 'Whisper transcription failed'}
      WHERE status = 'transcribing_handoff' AND storage_ref = ${args.storageId}
    `;
    return;
  }
  await db`
    UPDATE app.video_link_jobs SET
      status = ${args.transcriptionStatus},
      status_changed_at_ms = ${now},
      progress = NULL
    WHERE status = 'transcribing_handoff' AND storage_ref = ${args.storageId}
  `;
}

// ---------------------------------------------------------------- watchdog

const STATUS_WINDOWS: ReadonlyArray<readonly [string, number]> = [
  ['queued', 5 * 60_000],
  ['fetching_metadata', 5 * 60_000],
  ['fetching_captions', 10 * 60_000],
  ['extracting_audio', 20 * 60_000],
  ['indexing', 5 * 60_000],
];
const UNBOUND_GC_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const UNBOUND_GC_BATCH = 50;
const STUCK_RECOVERY_BATCH = 200;
/** How long a handoff row may sit over a MISSING file row before it is
 * declared dead. Matches the transcription lane's own stale window; live
 * runs advance `status_changed_at_ms` via the per-chunk heartbeat. */
const HANDOFF_ORPHAN_WINDOW_MS = 35 * 60_000;

/**
 * The 0.4 stuck-row watchdog + lazy GC: flip stuck non-terminal jobs to
 * `failed`/transient (per-status windows; a LIVE `transcribing_handoff` is
 * owned by the transcription pipeline's own recovery), reconcile parked
 * handoff rows whose transcription already settled (the safety net under
 * the settle cascade — and the heal for rows parked by older deployments),
 * fail handoff rows whose file row is gone, and reap terminal-but-unbound
 * rows older than 7 days (blob + non-completed file row + job).
 */
export async function runVideoLinkWatchdog(sql: Sql): Promise<void> {
  const now = Date.now();
  for (const [status, windowMs] of STATUS_WINDOWS) {
    const rows = await sql<{ id: string; status: string }[]>`
      SELECT id, status FROM app.video_link_jobs
      WHERE status = ${status}
        AND status_changed_at_ms < ${now - windowMs}
      LIMIT ${STUCK_RECOVERY_BATCH}
    `;
    for (const row of rows) {
      const flipped = await updateJob(sql, {
        jobId: row.id,
        status: 'failed',
        expectedStatus: status,
        errorReasonCode: 'transient',
        errorMessage: `Stuck in '${status}' for >${Math.round(windowMs / 60_000)}min — watchdog flipped to failed`,
      });
      if (flipped === 'ok') {
        await cleanupCancelledVideoLink(sql, row.id);
      }
    }
  }

  // Reconcile: a handoff row over a SETTLED file row mirrors the terminal
  // state, at ANY age. The settle cascade writes this transactionally on
  // the live path; this sweep is the idempotent backstop that also flips
  // the rows existing deployments parked forever (freeing their org's
  // ingest slots within one tick).
  const settledRows = await sql<
    { id: string; fileStatus: string; fileError: string | null }[]
  >`
    SELECT j.id, m.transcription_status AS "fileStatus",
           m.transcription_error AS "fileError"
    FROM app.video_link_jobs j
    JOIN app.file_metadata m ON m.id = j.file_metadata_id
    WHERE j.status = 'transcribing_handoff'
      AND m.transcription_status IN ('completed', 'failed', 'skipped')
    LIMIT ${STUCK_RECOVERY_BATCH}
  `;
  for (const row of settledRows) {
    if (row.fileStatus === 'failed') {
      await updateJob(sql, {
        jobId: row.id,
        status: 'failed',
        expectedStatus: 'transcribing_handoff',
        errorReasonCode: 'whisperFailed',
        errorMessage: row.fileError ?? 'Whisper transcription failed',
        progress: null,
      });
      continue;
    }
    await updateJob(sql, {
      jobId: row.id,
      status: row.fileStatus,
      expectedStatus: 'transcribing_handoff',
      progress: null,
    });
  }

  // A handoff row whose file row is GONE (or was never recorded) can never
  // settle — no engine write and no cascade will ever reach it. Fail it
  // once the transcription lane's own stale window has passed so the user
  // gets a retryable failure instead of a forever-spinner, and reap its
  // audio blob.
  const orphanRows = await sql<{ id: string }[]>`
    SELECT j.id
    FROM app.video_link_jobs j
    LEFT JOIN app.file_metadata m ON m.id = j.file_metadata_id
    WHERE j.status = 'transcribing_handoff'
      AND j.status_changed_at_ms < ${now - HANDOFF_ORPHAN_WINDOW_MS}
      AND (j.file_metadata_id IS NULL OR m.id IS NULL)
    LIMIT ${STUCK_RECOVERY_BATCH}
  `;
  for (const row of orphanRows) {
    const flipped = await updateJob(sql, {
      jobId: row.id,
      status: 'failed',
      expectedStatus: 'transcribing_handoff',
      errorReasonCode: 'whisperFailed',
      errorMessage: 'Transcription record disappeared — retry to re-process',
    });
    if (flipped === 'ok') {
      await cleanupCancelledVideoLink(sql, row.id);
    }
  }

  const gcRows = await sql<{ id: string }[]>`
    SELECT id FROM app.video_link_jobs
    WHERE status IN ('completed', 'failed', 'skipped')
      AND message_bound_at_ms IS NULL
      AND created_at_ms < ${now - UNBOUND_GC_AGE_MS}
    LIMIT ${UNBOUND_GC_BATCH}
  `;
  for (const row of gcRows) {
    const job = await getJob(sql, row.id);
    if (!job || job.messageBoundAt !== null) continue;
    if (job.storageRef !== null) {
      await deleteOrgBlobRefs(sql, job.organizationId, [job.storageRef]);
    }
    if (job.fileMetadataId !== null) {
      await sql`DELETE FROM app.file_metadata WHERE id = ${job.fileMetadataId}`;
    }
    await sql`DELETE FROM app.video_link_jobs WHERE id = ${row.id}`;
  }
}

// -------------------------------------------------------------- crawl host

function videoShimHandlers(sql: Sql): ShimHandlers {
  return {
    ...chatShimHandlers(sql),
    'video_links/internal_queries:getJobById': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the engine passes exactly this shape
      const args = raw as { jobId: string };
      const job = await getJob(sql, args.jobId);
      if (!job) return null;
      return {
        _id: job.id,
        _creationTime: job.createdAt,
        organizationId: job.organizationId,
        threadId: job.threadId ?? undefined,
        uploadedBy: job.uploadedBy,
        sourceUrl: job.sourceUrl,
        sourceUrlHash: job.sourceUrlHash,
        sourcePlatform: job.sourcePlatform,
        pastedToken: job.pastedToken,
        status: job.status,
        statusChangedAt: job.statusChangedAt,
        attempts: job.attempts ?? undefined,
        storageId: job.storageRef ?? undefined,
        fileMetadataId: job.fileMetadataId ?? undefined,
        messageBoundAt: job.messageBoundAt ?? undefined,
      };
    },
    'video_links/internal_mutations:updateJob': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the engine passes exactly this shape
      const args = raw as Parameters<typeof updateJob>[1] & {
        storageId?: string;
      };
      const { storageId, ...rest } = args;
      return updateJob(sql, {
        ...rest,
        ...(storageId !== undefined ? { storageRef: storageId } : {}),
      });
    },
    'video_links/internal_mutations:insertSyntheticFileMetadata': async (
      raw,
    ) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the engine passes exactly this shape
      const args = raw as Parameters<typeof insertSyntheticFileMetadata>[1];
      return insertSyntheticFileMetadata(sql, args);
    },
    'file_metadata/internal_mutations:saveFileMetadata': async (raw) => {
      // The whisper-branch handoff: insert the audio row (thread-scoped,
      // trust-distinct `video_link` source) and enqueue the inc-68
      // transcription pipeline — the 0.4 internal saveFileMetadata's audio
      // branch in one place.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the engine passes exactly this shape
      const args = raw as {
        organizationId: string;
        storageId: string;
        fileName: string;
        contentType: string;
        size: number;
        source?: string;
        uploadedBy?: string;
        threadId?: string;
      };
      return sql.begin(async (tx) => {
        const inserted = await tx<{ id: string }[]>`
          INSERT INTO app.file_metadata (
            org_id, storage_ref, file_name, content_type, size, source,
            uploaded_by, thread_id, transcription_status, created_at_ms
          ) VALUES (
            ${args.organizationId}, ${args.storageId}, ${args.fileName},
            ${args.contentType}, ${args.size}, ${args.source ?? null},
            ${args.uploadedBy ?? null}, ${args.threadId ?? null}, 'queued',
            ${Date.now()}
          )
          RETURNING id
        `;
        const id = inserted[0]?.id;
        if (!id) throw new Error('audio file insert failed');
        await addJobInTx(tx, 'files.transcribe', {
          storageId: args.storageId,
          fileName: args.fileName,
          contentType: args.contentType,
          organizationId: args.organizationId,
        });
        return id;
      });
    },
    'browser_sessions/sessions:claimBrowserSession': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the engine passes exactly this shape
      const args = raw as { organizationId: string; domain: string };
      return claimBrowserSession(sql, args);
    },
    'browser_sessions/sessions:reportBrowserSessionResult': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the engine passes exactly this shape
      const args = raw as { sessionId: string; outcome: 'ok' | 'blocked' };
      await reportBrowserSessionResult(sql, args);
      return null;
    },
  };
}

function videoScheduler(sql: Sql): ShimScheduler {
  return async (name, delayMs, args) => {
    if (name === 'video_links/ingest_video_link:ingestVideoLink') {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the engine self-retries with exactly this shape
      const payload = args as { jobId: string; userLocale?: string };
      await addJobInTx(
        sql,
        'video.ingest',
        {
          jobId: payload.jobId,
          ...(payload.userLocale !== undefined
            ? { userLocale: payload.userLocale }
            : {}),
        },
        delayMs > 0 ? { startAfter: new Date(Date.now() + delayMs) } : {},
      );
      return;
    }
    if (name === 'video_links/internal_mutations:cleanupCancelledVideoLink') {
      // runAfter(0, …) in 0.4 — an immediate best-effort cleanup.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the engine passes exactly this shape
      const payload = args as { jobId: string };
      await cleanupCancelledVideoLink(sql, payload.jobId);
      return;
    }
    throw new Error(`[video_links] unmapped scheduled ref: ${name}`);
  };
}

/** One ingest attempt — the reused orchestrator on the shim. `putBlob`'s
 * S3 branch inside it is ctx-free; the Convex fallback would only fire
 * for an unresolvable org and fails loud on the shim. */
export async function runVideoIngestJob(
  sql: Sql,
  payload: { jobId: string; userLocale?: string },
): Promise<void> {
  const ctx = createCtxShim(videoShimHandlers(sql), {
    scheduler: videoScheduler(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reused orchestrator's ActionCtx surface is exactly what the shim provides
  await ingestVideoLinkImpl(ctx as never, {
    jobId: payload.jobId,
    ...(payload.userLocale !== undefined
      ? { userLocale: payload.userLocale }
      : {}),
  });
}

// ------------------------------------------------------------------ ingest

interface TranscriptDonorRow {
  job: VideoLinkJobRow;
  metaId: string;
  transcript: string;
  fileName: string;
  transcriptionDurationSec: number | null;
}

/** Newest reusable transcript for (org, hash) — the 0.4 donor semantics:
 * linked file row alive, transcription completed, transcript text present
 * (blob presence NOT required — cancel keeps the row). */
async function findReusableTranscriptDonor(
  sql: Sql,
  organizationId: string,
  sourceUrlHash: string,
  now: number,
): Promise<TranscriptDonorRow | null> {
  const jobs = await sql<VideoLinkJobRow[]>`
    SELECT ${sql.unsafe(JOB_COLUMNS)} FROM app.video_link_jobs
    WHERE org_id = ${organizationId} AND source_url_hash = ${sourceUrlHash}
      AND created_at_ms > ${now - TRANSCRIPT_REUSE_MAX_AGE_MS}
    ORDER BY created_at_ms DESC
    LIMIT ${DONOR_SCAN_LIMIT}
  `;
  for (const job of jobs) {
    if (job.lifecycleStatus === 'trashed') continue;
    if (job.fileMetadataId === null) continue;
    const metas = await sql<
      {
        id: string;
        transcript: string | null;
        fileName: string;
        durationSec: number | null;
        lifecycleStatus: string | null;
        transcriptionStatus: string | null;
      }[]
    >`
      SELECT id, transcript, file_name AS "fileName",
             transcription_duration_sec AS "durationSec",
             lifecycle_status AS "lifecycleStatus",
             transcription_status AS "transcriptionStatus"
      FROM app.file_metadata WHERE id = ${job.fileMetadataId} LIMIT 1
    `;
    const meta = metas[0];
    if (!meta) continue;
    if (meta.lifecycleStatus === 'trashed') continue;
    if (meta.transcriptionStatus !== 'completed') continue;
    if (typeof meta.transcript !== 'string' || meta.transcript.length === 0) {
      continue;
    }
    return {
      job,
      metaId: meta.id,
      transcript: meta.transcript,
      fileName: meta.fileName,
      transcriptionDurationSec: meta.durationSec,
    };
  }
  return null;
}

/** Clone a donor transcript for a fresh job (the 0.4 clone action,
 * natively): own blob copy, finalize CAS-gated on 'indexing'; a vanished
 * donor degrades to the full pipeline. */
export async function runVideoCloneJob(
  sql: Sql,
  payload: {
    jobId: string;
    donorFileMetadataId: string;
    organizationId: string;
  },
): Promise<void> {
  try {
    const metas = await sql<
      {
        organizationId: string;
        transcript: string | null;
        fileName: string;
        durationSec: number | null;
        transcriptionStatus: string | null;
      }[]
    >`
      SELECT org_id AS "organizationId", transcript,
             file_name AS "fileName",
             transcription_duration_sec AS "durationSec",
             transcription_status AS "transcriptionStatus"
      FROM app.file_metadata
      WHERE id = ${payload.donorFileMetadataId} LIMIT 1
    `;
    const donor = metas[0];
    if (
      !donor ||
      donor.organizationId !== payload.organizationId ||
      donor.transcriptionStatus !== 'completed' ||
      typeof donor.transcript !== 'string' ||
      donor.transcript.length === 0
    ) {
      const reset = await updateJob(sql, {
        jobId: payload.jobId,
        status: 'queued',
        expectedStatus: 'indexing',
      });
      if (reset === 'ok') {
        await addJobInTx(sql, 'video.ingest', { jobId: payload.jobId });
      }
      return;
    }
    const bytes = new TextEncoder().encode(donor.transcript);
    const storageId = await putOrgBlobBytes(sql, payload.organizationId, {
      bytes,
      contentType: 'text/plain; charset=utf-8',
    });
    await finalizeClonedTranscript(sql, {
      jobId: payload.jobId,
      storageId,
      organizationId: payload.organizationId,
      transcript: donor.transcript,
      fileName: donor.fileName,
      fileSize: bytes.byteLength,
      ...(donor.durationSec !== null
        ? { transcriptionDurationSec: donor.durationSec }
        : {}),
    });
  } catch (error) {
    console.error(
      `[video_links] clone failed for job ${payload.jobId}:`,
      error instanceof Error ? error.message : error,
    );
    await updateJob(sql, {
      jobId: payload.jobId,
      status: 'failed',
      expectedStatus: 'indexing',
      errorReasonCode: 'transient',
      errorMessage: 'Transcript clone failed — retry to re-fetch',
    });
  }
}

async function countInFlight(
  sql: Sql,
  organizationId: string,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.video_link_jobs
    WHERE org_id = ${organizationId}
      AND status = ANY(${[...NON_TERMINAL_STATUSES]})
  `;
  return Number(rows[0]?.count ?? '0');
}

const PROSPECTIVE_VIDEO_LINK_COST_CENTS = Math.ceil(
  (CHAT_AUDIO_MAX_DURATION_SEC / 60) * 0.6,
);

async function assertVideoBudget(
  sql: Sql,
  organizationId: string,
  userId: string,
): Promise<void> {
  const userTeamIds = await getUserTeamIds(sql, userId);
  const budget = await checkTtsBudget(sql, {
    organizationId,
    userId,
    userTeamIds,
    prospectiveCostCents: PROSPECTIVE_VIDEO_LINK_COST_CENTS,
    prospectiveRequests: 1,
  });
  if (!budget.allowed) {
    throw new VideoLinkError(
      'budgetExceeded',
      budget.reason ?? 'Usage limit reached — contact your administrator.',
      429,
    );
  }
}

/**
 * Ingest a pasted video URL (the 0.4 `ingestVideoUrl`): playlist refusal,
 * budget gate (worst-case prospective Whisper cost), server-derived dedup
 * key + platform, in-thread dedup, org-wide donor clone (before — and
 * exempt from — the in-flight cap), cap, insert + `video.ingest` job.
 * The route owns org membership + thread access + the rate limit.
 */
export async function ingestVideoUrl(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    threadId?: string;
    url: string;
    pastedToken: string;
    userLocale?: string;
  },
): Promise<string> {
  if (isPlaylistUrl(args.url)) {
    throw new VideoLinkError(
      'playlist',
      'Playlist URLs are not supported — paste a single video link instead',
    );
  }
  await assertVideoBudget(sql, args.organizationId, args.userId);

  const serverNormalized = normalizeUrlForHash(args.url);
  const serverPlatform = detectPlatform(args.url);
  const sourceUrlHash = hashUrlForDedup(serverNormalized);
  const now = Date.now();

  // In-thread dedup (welcome-page pastes skip it — the 0.4 two-tabs bug).
  if (args.threadId !== undefined) {
    const existing = await sql<VideoLinkJobRow[]>`
      SELECT ${sql.unsafe(JOB_COLUMNS)} FROM app.video_link_jobs
      WHERE org_id = ${args.organizationId}
        AND source_url_hash = ${sourceUrlHash}
      ORDER BY created_at_ms DESC
      LIMIT 1
    `;
    const hit = existing[0];
    if (
      hit &&
      hit.messageBoundAt === null &&
      hit.threadId === args.threadId &&
      hit.uploadedBy === args.userId &&
      hit.status !== 'failed' &&
      hit.status !== 'skipped' &&
      now - hit.createdAt < DEDUP_WINDOW_MS
    ) {
      if (args.pastedToken !== hit.pastedToken) {
        await sql`
          UPDATE app.video_link_jobs SET pasted_token = ${args.pastedToken}
          WHERE id = ${hit.id}
        `;
      }
      return hit.id;
    }
  }

  // Donor clone — no yt-dlp slot consumed, so checked BEFORE the cap.
  const donor = await findReusableTranscriptDonor(
    sql,
    args.organizationId,
    sourceUrlHash,
    now,
  );
  if (donor) {
    const inserted = await sql.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        INSERT INTO app.video_link_jobs (
          org_id, thread_id, uploaded_by, source_url, source_url_hash,
          source_platform, pasted_token, status, status_changed_at_ms,
          attempts, lifecycle_status, video_title, video_uploader,
          video_duration_sec, video_language, video_chapters,
          transcript_source, caption_track_kind, caption_lang, created_at_ms
        ) VALUES (
          ${args.organizationId}, ${args.threadId ?? null}, ${args.userId},
          ${args.url}, ${sourceUrlHash}, ${serverPlatform},
          ${args.pastedToken}, 'indexing', ${now}, 0, 'active',
          ${donor.job.videoTitle}, ${donor.job.videoUploader},
          ${donor.job.videoDurationSec}, ${donor.job.videoLanguage},
          ${donor.job.videoChapters === null ? null : tx.json(toJson(donor.job.videoChapters))},
          ${donor.job.transcriptSource}, ${donor.job.captionTrackKind},
          ${donor.job.captionLang}, ${now}
        )
        RETURNING id
      `;
      const jobId = rows[0]?.id;
      if (!jobId) throw new Error('video job insert failed');
      await addJobInTx(tx, 'video.clone', {
        jobId,
        donorFileMetadataId: donor.metaId,
        organizationId: args.organizationId,
      });
      await createAuditLog(tx, {
        organizationId: args.organizationId,
        actorId: args.userId,
        actorType: 'user',
        action: 'video_link.ingest',
        category: 'data',
        resourceType: 'video_link_job',
        resourceId: jobId,
        status: 'success',
        metadata: {
          sourcePlatform: serverPlatform,
          sourceUrlHash,
          reusedTranscript: true,
          donorJobId: donor.job.id,
          ...(args.threadId !== undefined ? { threadId: args.threadId } : {}),
        },
      });
      return jobId;
    });
    return inserted;
  }

  if (
    (await countInFlight(sql, args.organizationId)) >= MAX_IN_FLIGHT_PER_ORG
  ) {
    throw new VideoLinkError(
      'inFlightCap',
      `At most ${MAX_IN_FLIGHT_PER_ORG} video links can process at once. Wait for one to finish.`,
      429,
    );
  }

  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      INSERT INTO app.video_link_jobs (
        org_id, thread_id, uploaded_by, source_url, source_url_hash,
        source_platform, pasted_token, status, status_changed_at_ms,
        attempts, lifecycle_status, created_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.threadId ?? null}, ${args.userId},
        ${args.url}, ${sourceUrlHash}, ${serverPlatform},
        ${args.pastedToken}, 'queued', ${now}, 0, 'active', ${now}
      )
      RETURNING id
    `;
    const jobId = rows[0]?.id;
    if (!jobId) throw new Error('video job insert failed');
    await addJobInTx(tx, 'video.ingest', {
      jobId,
      ...(args.userLocale !== undefined ? { userLocale: args.userLocale } : {}),
    });
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.userId,
      actorType: 'user',
      action: 'video_link.ingest',
      category: 'data',
      resourceType: 'video_link_job',
      resourceId: jobId,
      status: 'success',
      metadata: {
        sourcePlatform: serverPlatform,
        sourceUrlHash,
        ...(args.threadId !== undefined ? { threadId: args.threadId } : {}),
      },
    });
    return jobId;
  });
}

/** Cancel / dismiss (the 0.4 semantics): flip to `skipped`, propagate a
 * whisper-in-flight skip onto the file row, schedule cleanup. Uploader-only. */
/** Enqueue-time claim for a deferred send (the 0.4 `bindJobsForDeferredSend`):
 * stamp `message_bound_at_ms` (+ thread for welcome-page rows) on every
 * claimable job — the stamp releases the chips from the composer and keeps
 * the direct-send bind from double-taking them. Returns the ids claimed. */
export async function bindJobsForDeferredSend(
  sql: Sql,
  args: {
    jobIds: readonly string[];
    userId: string;
    threadId: string;
    organizationId: string;
  },
): Promise<string[]> {
  if (args.jobIds.length === 0) return [];
  return sql.begin(async (tx) => {
    const now = Date.now();
    const claimed: string[] = [];
    for (const jobId of args.jobIds) {
      const rows = await tx<{ id: string }[]>`
        UPDATE app.video_link_jobs
        SET message_bound_at_ms = ${now},
            thread_id = coalesce(thread_id, ${args.threadId})
        WHERE id = ${jobId} AND org_id = ${args.organizationId}
          AND uploaded_by = ${args.userId}
          AND message_bound_at_ms IS NULL
          AND status <> 'skipped'
          AND lifecycle_status IS DISTINCT FROM 'trashed'
        RETURNING id
      `;
      if (rows[0]) claimed.push(rows[0].id);
    }
    return claimed;
  });
}

/** Fire-time payloads for a deferred send's claimed jobs (the 0.4
 * `buildBoundJobAttachments`): the same shape the direct-send bind puts on
 * attachments — `video/mp4` stays the routing sentinel. Jobs without a
 * completed transcript by now are excluded; the turn proceeds without. */
export async function buildBoundJobAttachments(
  sql: Sql,
  organizationId: string,
  jobIds: readonly string[],
): Promise<
  { fileId: string; fileName: string; fileType: string; fileSize: number }[]
> {
  const out: {
    fileId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
  }[] = [];
  for (const jobId of jobIds) {
    const rows = await sql<
      {
        storageRef: string | null;
        videoTitle: string | null;
        status: string;
        transcriptionStatus: string | null;
        size: number | null;
      }[]
    >`
      SELECT j.storage_ref AS "storageRef", j.video_title AS "videoTitle",
             j.status, m.transcription_status AS "transcriptionStatus",
             m.size::float8 AS "size"
      FROM app.video_link_jobs j
      LEFT JOIN app.file_metadata m ON m.id = j.file_metadata_id
      WHERE j.id = ${jobId} AND j.org_id = ${organizationId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row || row.storageRef === null || row.size === null) continue;
    const transcriptReady =
      row.status === 'completed' ||
      (row.status === 'transcribing_handoff' &&
        row.transcriptionStatus === 'completed');
    if (!transcriptReady) continue;
    out.push({
      fileId: row.storageRef,
      fileName: row.videoTitle ?? 'Video link',
      fileType: 'video/mp4',
      fileSize: row.size,
    });
  }
  return out;
}

/** Delete-time cascade (the 0.4 `cancelDeferredJobs`): cancelling a waiting
 * send cancels its claimed media too — unbind IN THE SAME update (the
 * cleanup refuses message-bound rows), flip to skipped, propagate the
 * Whisper early-exit, schedule cleanup. */
export async function cancelDeferredJobs(
  sql: Sql,
  organizationId: string,
  jobIds: readonly string[],
  userId: string,
): Promise<void> {
  for (const jobId of jobIds) {
    const job = await getJob(sql, jobId);
    if (!job || job.organizationId !== organizationId) continue;
    if (job.uploadedBy !== userId) continue;
    if (job.status === 'skipped') {
      if (job.messageBoundAt !== null) {
        await sql`
          UPDATE app.video_link_jobs SET message_bound_at_ms = NULL
          WHERE id = ${jobId}
        `;
      }
      continue;
    }
    await sql`
      UPDATE app.video_link_jobs
      SET message_bound_at_ms = NULL, status = 'skipped',
          status_changed_at_ms = ${Date.now()}
      WHERE id = ${jobId}
    `;
    if (
      job.fileMetadataId !== null &&
      job.storageRef !== null &&
      job.status === 'transcribing_handoff'
    ) {
      // Only an in-flight transcription is skipped along; a SETTLED file
      // row keeps its state — clobbering a completed transcript here would
      // hand it to the cleanup's delete and destroy the org's donor copy.
      await sql`
        UPDATE app.file_metadata SET transcription_status = 'skipped'
        WHERE storage_ref = ${job.storageRef}
          AND transcription_status IN ('queued', 'running')
      `;
    }
    await cleanupCancelledVideoLink(sql, jobId);
  }
}

export async function cancelVideoLink(
  sql: Sql,
  args: { organizationId: string; userId: string; jobId: string },
): Promise<void> {
  const job = await getJob(sql, args.jobId);
  if (!job || job.organizationId !== args.organizationId) {
    throw new VideoLinkError('notFound', 'Video link not found', 404);
  }
  if (job.uploadedBy !== args.userId) {
    throw new VideoLinkError(
      'notUploader',
      'Only the uploader can cancel this video link',
      403,
    );
  }
  if (job.status === 'skipped') return;

  // The cancel is a CAS on the state the user saw. The finalizers settle a
  // job `indexing → completed` in one transaction; a cancel that landed on
  // that completed row afterwards would take its blob with it (the cleanup
  // keeps a completed file row) and leave a Ready chip over deleted bytes.
  // A job that merely ADVANCED (still in flight) is cancelled in its new
  // state; a job that SETTLED on its own is left as it settled.
  let cancelled = job;
  for (;;) {
    const flipped = await updateJob(sql, {
      jobId: args.jobId,
      status: 'skipped',
      expectedStatus: cancelled.status,
    });
    if (flipped === 'ok') break;
    if (flipped === 'not_found') return;
    const current = await getJob(sql, args.jobId);
    if (!current || current.status === 'skipped') return;
    if (!isNonTerminalStatus(current.status)) return;
    cancelled = current;
  }
  if (
    cancelled.fileMetadataId !== null &&
    cancelled.storageRef !== null &&
    cancelled.status === 'transcribing_handoff'
  ) {
    // Only an in-flight transcription is skipped along; a SETTLED file row
    // keeps its state — clobbering a completed transcript here would hand
    // it to the cleanup's delete and destroy the org's donor copy (the
    // donor contract at findReusableTranscriptDonor: cancel keeps the row).
    await sql`
      UPDATE app.file_metadata SET transcription_status = 'skipped'
      WHERE storage_ref = ${cancelled.storageRef}
        AND transcription_status IN ('queued', 'running')
    `;
  }
  await cleanupCancelledVideoLink(sql, args.jobId);
  await sql.begin((tx) =>
    createAuditLog(tx, {
      organizationId: job.organizationId,
      actorId: args.userId,
      actorType: 'user',
      action: 'video_link.cancel',
      category: 'data',
      resourceType: 'video_link_job',
      resourceId: args.jobId,
      status: 'success',
      metadata: {
        sourcePlatform: job.sourcePlatform,
        sourceUrlHash: job.sourceUrlHash,
        previousStatus: job.status,
      },
    }),
  );
}

/**
 * The retry door's truth table. Terminal `failed`/`skipped` jobs retry as
 * always; a `transcribing_handoff` job retries exactly when its file row's
 * transcription settled failed/skipped — the chip already shows Retry for
 * that shape (the reactive join), so the door must accept it even if the
 * settle cascade was missed (rows parked by older deployments, drift).
 * A live handoff (file queued/running) and every other in-flight status
 * stay non-retryable: retrying them would double-run the pipeline.
 */
export function isVideoJobRetryable(
  jobStatus: string,
  fileTranscriptionStatus: string | null,
): boolean {
  if (jobStatus === 'failed' || jobStatus === 'skipped') return true;
  return (
    jobStatus === 'transcribing_handoff' &&
    (fileTranscriptionStatus === 'failed' ||
      fileTranscriptionStatus === 'skipped')
  );
}

/** Retry a failed/skipped job (the 0.4 semantics): bot-wall cooldown,
 * the same abuse gates as ingest, cleanup of stale artifacts, re-queue.
 * Accepts a whisper handoff whose transcription settled failed/skipped —
 * the cleanup below resets the file lane (drops the settled-non-completed
 * file row + blob) so the re-queued pipeline starts coherently. */
export async function retryVideoLink(
  sql: Sql,
  args: { organizationId: string; userId: string; jobId: string },
): Promise<void> {
  const job = await getJob(sql, args.jobId);
  if (!job || job.organizationId !== args.organizationId) {
    throw new VideoLinkError('notFound', 'Video link not found', 404);
  }
  if (job.uploadedBy !== args.userId) {
    throw new VideoLinkError(
      'notUploader',
      'Only the uploader can retry this video link',
      403,
    );
  }
  let fileTranscriptionStatus: string | null = null;
  if (job.status === 'transcribing_handoff' && job.fileMetadataId !== null) {
    const metas = await sql<{ status: string | null }[]>`
      SELECT transcription_status AS status FROM app.file_metadata
      WHERE id = ${job.fileMetadataId} LIMIT 1
    `;
    fileTranscriptionStatus = metas[0]?.status ?? null;
  }
  if (!isVideoJobRetryable(job.status, fileTranscriptionStatus)) {
    throw new VideoLinkError(
      'notRetryable',
      `Can only retry failed or skipped video links (current: ${job.status})`,
      409,
    );
  }
  if (
    (job.errorReasonCode === 'botDetection' ||
      job.errorReasonCode === 'rateLimited') &&
    Date.now() - job.statusChangedAt < RETRY_COOLDOWN_MS
  ) {
    throw new VideoLinkError(
      'retryCooldown',
      'This video failed with a rate-limit / bot-detection signal. Please wait a few minutes before retrying.',
      429,
    );
  }
  await assertVideoBudget(sql, args.organizationId, args.userId);
  if (
    (await countInFlight(sql, args.organizationId)) >= MAX_IN_FLIGHT_PER_ORG
  ) {
    throw new VideoLinkError(
      'inFlightCap',
      `At most ${MAX_IN_FLIGHT_PER_ORG} video links can process at once. Wait for one to finish.`,
      429,
    );
  }

  await cleanupCancelledVideoLink(sql, args.jobId);
  await sql.begin(async (tx) => {
    await updateJob(tx, {
      jobId: args.jobId,
      status: 'queued',
      attempts: (job.attempts ?? 0) + 1,
      errorReasonCode: null,
      errorMessage: null,
      progress: null,
    });
    await addJobInTx(tx, 'video.ingest', { jobId: args.jobId });
    await createAuditLog(tx, {
      organizationId: job.organizationId,
      actorId: args.userId,
      actorType: 'user',
      action: 'video_link.retry',
      category: 'data',
      resourceType: 'video_link_job',
      resourceId: args.jobId,
      status: 'success',
      metadata: {
        sourcePlatform: job.sourcePlatform,
        sourceUrlHash: job.sourceUrlHash,
        previousErrorReasonCode: job.errorReasonCode,
        attempts: (job.attempts ?? 0) + 1,
      },
    });
  });
}

// ---------------------------------------------------------------- chip view

export interface VideoLinkJobView {
  jobId: string;
  sourceUrl: string;
  sourcePlatform: string;
  pastedToken: string;
  videoTitle?: string;
  videoUploader?: string;
  videoDurationSec?: number;
  transcriptSource?: string;
  captionLang?: string;
  displayStatus: string;
  progress?: string;
  errorReasonCode?: string;
  errorMessage?: string;
  attempts?: number;
  storageId?: string;
  fileSize?: number;
  messageBoundAt?: number;
  uploadedBy: string;
  createdAt: number;
}

/** The 0.4 `projectJob`: retry-state surfacing + the reactive whisper join
 * (fileMetadata.transcription_status drives displayStatus). */
async function projectJob(
  sql: Sql,
  job: VideoLinkJobRow,
): Promise<VideoLinkJobView> {
  let displayStatus = job.status;
  let progress = job.progress ?? undefined;
  let errorReasonCode = job.errorReasonCode ?? undefined;
  let errorMessage = job.errorMessage ?? undefined;

  if (
    displayStatus === 'queued' &&
    (job.attempts ?? 0) > 0 &&
    errorReasonCode !== undefined
  ) {
    displayStatus = 'retrying';
    progress = progress ?? `__VL_ATTEMPT__${job.attempts}`;
  }

  let fileSize: number | undefined;
  if (job.fileMetadataId !== null) {
    const metas = await sql<
      {
        size: number;
        transcriptionStatus: string | null;
        transcriptionProgress: string | null;
        transcriptionError: string | null;
      }[]
    >`
      SELECT size, transcription_status AS "transcriptionStatus",
             transcription_progress AS "transcriptionProgress",
             transcription_error AS "transcriptionError"
      FROM app.file_metadata WHERE id = ${job.fileMetadataId} LIMIT 1
    `;
    const meta = metas[0];
    if (meta) {
      fileSize = meta.size;
      if (job.status === 'transcribing_handoff') {
        if (meta.transcriptionStatus === 'running') {
          displayStatus = 'transcribing_handoff';
          progress = meta.transcriptionProgress ?? progress;
        } else if (meta.transcriptionStatus === 'completed') {
          displayStatus = 'completed';
        } else if (meta.transcriptionStatus === 'failed') {
          displayStatus = 'failed';
          errorReasonCode = errorReasonCode ?? 'whisperFailed';
          errorMessage = errorMessage ?? meta.transcriptionError ?? undefined;
        } else if (meta.transcriptionStatus === 'skipped') {
          displayStatus = 'skipped';
        }
      }
    }
  }

  return {
    jobId: job.id,
    sourceUrl: job.sourceUrl,
    sourcePlatform: job.sourcePlatform,
    pastedToken: job.pastedToken,
    ...(job.videoTitle !== null ? { videoTitle: job.videoTitle } : {}),
    ...(job.videoUploader !== null ? { videoUploader: job.videoUploader } : {}),
    ...(job.videoDurationSec !== null
      ? { videoDurationSec: job.videoDurationSec }
      : {}),
    ...(job.transcriptSource !== null
      ? { transcriptSource: job.transcriptSource }
      : {}),
    ...(job.captionLang !== null ? { captionLang: job.captionLang } : {}),
    displayStatus,
    ...(progress !== undefined ? { progress } : {}),
    ...(errorReasonCode !== undefined ? { errorReasonCode } : {}),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    ...(job.attempts !== null ? { attempts: job.attempts } : {}),
    ...(job.storageRef !== null ? { storageId: job.storageRef } : {}),
    ...(fileSize !== undefined ? { fileSize } : {}),
    ...(job.messageBoundAt !== null
      ? { messageBoundAt: job.messageBoundAt }
      : {}),
    uploadedBy: job.uploadedBy,
    createdAt: job.createdAt,
  };
}

export async function listForThread(
  sql: Sql,
  organizationId: string,
  threadId: string,
): Promise<VideoLinkJobView[]> {
  const rows = await sql<VideoLinkJobRow[]>`
    SELECT ${sql.unsafe(JOB_COLUMNS)} FROM app.video_link_jobs
    WHERE thread_id = ${threadId} AND org_id = ${organizationId}
      AND lifecycle_status IS DISTINCT FROM 'trashed'
    ORDER BY created_at_ms ASC
  `;
  const views: VideoLinkJobView[] = [];
  for (const row of rows) views.push(await projectJob(sql, row));
  return views;
}

export async function listUnboundForUser(
  sql: Sql,
  organizationId: string,
  userId: string,
): Promise<VideoLinkJobView[]> {
  const rows = await sql<VideoLinkJobRow[]>`
    SELECT ${sql.unsafe(JOB_COLUMNS)} FROM app.video_link_jobs
    WHERE org_id = ${organizationId} AND uploaded_by = ${userId}
      AND thread_id IS NULL
      AND lifecycle_status IS DISTINCT FROM 'trashed'
    ORDER BY created_at_ms ASC
  `;
  const views: VideoLinkJobView[] = [];
  for (const row of rows) views.push(await projectJob(sql, row));
  return views;
}

// --------------------------------------------------------------- send bind

export interface BoundAttachment {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  pastedToken: string;
  jobId: string;
}

/**
 * Atomically bind completed-and-unbound jobs to an outgoing message (the
 * 0.4 `bindCompletedJobsToMessage`): thread rows + the caller's pre-thread
 * rows, ready = completed OR whisper-handoff whose file row finished;
 * uploader-owned only; stamps `message_bound_at_ms` (+ threadId for
 * welcome-page rows) and answers the attachment payloads.
 */
export async function bindCompletedJobsToMessage(
  sql: Sql,
  args: { organizationId: string; userId: string; threadId: string },
): Promise<BoundAttachment[]> {
  return sql.begin(async (tx) => {
    const candidates = await tx<VideoLinkJobRow[]>`
      SELECT ${tx.unsafe(JOB_COLUMNS)} FROM app.video_link_jobs
      WHERE org_id = ${args.organizationId}
        AND lifecycle_status IS DISTINCT FROM 'trashed'
        AND (thread_id = ${args.threadId}
             OR (thread_id IS NULL AND uploaded_by = ${args.userId}))
      ORDER BY created_at_ms ASC
      FOR UPDATE
    `;
    const out: BoundAttachment[] = [];
    for (const job of candidates) {
      if (job.uploadedBy !== args.userId) continue;
      if (job.messageBoundAt !== null) continue;
      if (job.storageRef === null || job.fileMetadataId === null) continue;

      let ready = job.status === 'completed';
      if (!ready && job.status === 'transcribing_handoff') {
        const metas = await tx<{ transcriptionStatus: string | null }[]>`
          SELECT transcription_status AS "transcriptionStatus"
          FROM app.file_metadata WHERE id = ${job.fileMetadataId} LIMIT 1
        `;
        ready = metas[0]?.transcriptionStatus === 'completed';
      }
      if (!ready) continue;

      const metas = await tx<{ size: number }[]>`
        SELECT size FROM app.file_metadata
        WHERE id = ${job.fileMetadataId} LIMIT 1
      `;
      const meta = metas[0];
      if (!meta) continue;

      await tx`
        UPDATE app.video_link_jobs SET
          thread_id = coalesce(thread_id, ${args.threadId}),
          message_bound_at_ms = ${Date.now()}
        WHERE id = ${job.id}
      `;
      out.push({
        fileId: job.storageRef,
        fileType: 'video/mp4',
        fileName: job.videoTitle ?? 'Video link',
        fileSize: meta.size,
        pastedToken: job.pastedToken,
        jobId: job.id,
      });
    }
    return out;
  });
}

/**
 * Reverse a bind after a failed send (the 0.4 twin) — idempotent for the
 * caller's OWN rows in THIS organization. Every supplied id must resolve to
 * such a row or the whole batch is refused before anything changes: a job
 * the caller holds in another organization is not theirs here (the org is
 * the scope, like every other video-links verb), and an id the composer
 * never held is a probe, not a chip.
 *
 * A job whose transcript already rides a SENT message in its thread stays
 * bound. The server can tell — the user row carries the attachment part —
 * and unbinding it would hand the transcript to the unbound-GC a week later
 * and strand the sent message's attachment; the legitimate caller (a send
 * that failed) never has such a message.
 */
export async function unbindJobsFromMessage(
  sql: Sql,
  args: { organizationId: string; userId: string; jobIds: readonly string[] },
): Promise<void> {
  const jobIds = [...new Set(args.jobIds)];
  if (jobIds.length === 0) return;
  await sql.begin(async (tx) => {
    const owned = await tx<{ id: string }[]>`
      SELECT id FROM app.video_link_jobs
      WHERE id = ANY(${jobIds}) AND org_id = ${args.organizationId}
        AND uploaded_by = ${args.userId}
      FOR UPDATE
    `;
    if (owned.length !== jobIds.length) {
      throw new VideoLinkError('notFound', 'Video link not found', 404);
    }
    await tx`
      UPDATE app.video_link_jobs j SET message_bound_at_ms = NULL
      WHERE j.id = ANY(${jobIds}) AND j.org_id = ${args.organizationId}
        AND j.uploaded_by = ${args.userId}
        AND j.message_bound_at_ms IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM app.messages m
          WHERE m.thread_id = j.thread_id AND m.role = 'user'
            AND m.parts @> jsonb_build_array(jsonb_build_object(
              'type', 'attachment', 'fileId', j.storage_ref
            ))
        )
    `;
  });
}

/** Video-link provenance for RAG retrieval wrapping (the 0.4
 * `lookupVideoLinkSources` leg the chat shim serves). */
export async function lookupVideoLinkSources(
  sql: Sql,
  storageRefs: readonly string[],
): Promise<{ storageId: string; sourceUrl: string; sourcePlatform: string }[]> {
  if (storageRefs.length === 0) return [];
  const rows = await sql<
    { storageId: string; sourceUrl: string; sourcePlatform: string }[]
  >`
    SELECT storage_ref AS "storageId", source_url AS "sourceUrl",
           source_platform AS "sourcePlatform"
    FROM app.video_link_jobs
    WHERE storage_ref = ANY(${[...storageRefs]})
  `;
  return rows;
}
