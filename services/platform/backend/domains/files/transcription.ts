import type { Sql, TransactionSql } from 'postgres';

import { checkProviderHostPolicy } from '../../../lib/net/host-policy.ts';
import { TRANSCRIPTION_SLUG } from '../../../lib/shared/constants/usage.ts';
import { probeAudioDurationSec } from '../../core/file_metadata/audio_preprocess.ts';
import { transcribeAudioImpl } from '../../core/file_metadata/transcribe_audio.ts';
import { pickExtensionFromMime } from '../../core/file_metadata/transcribe_dictation.ts';
import { requestTranscription } from '../../core/file_metadata/transcription_request.ts';
import { resolveTranscriptionModel } from '../../core/lib/providers/resolve_transcription_model.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  createCtxShim,
  type ShimHandlers,
  type ShimScheduler,
} from '../../lib/ctx-shim.ts';
import { chatShimHandlers } from '../chat/shim.ts';
import {
  heartbeatJobByStorageRef,
  settleHandoffJobsByStorageRef,
} from '../video_links/service.ts';
import { FileError } from './service.ts';
import {
  openTranscriptionCall,
  releaseTranscriptionCall,
  settleTranscriptionCall,
  type TranscriptionModelFacts,
  uploadTranscriptionSubject,
} from './transcription-metering.ts';

/**
 * Audio transcription — the 0.5 host for the REUSED 0.4 pipeline
 * (`transcribe_audio.ts`, hoisted): ffmpeg compress (silence-strip, Opus 32k
 * mono) → chunk when still over the provider cap → sequential
 * `/audio/transcriptions` calls → paragraphized transcript on the file row →
 * ledger minutes. The engine's ctx runs on the chat shim (the provider walk
 * `resolveTranscriptionModel` shares with TTS/dictation) plus the file-row
 * verbs below; its `[30s, 60s, 120s]` retry self-chain maps onto delayed
 * `files.transcribe` jobs. Transcription dedup — the same bytes transcribed
 * once per org and model/endpoint, whatever blob they arrive in — stays alive
 * on pg: the engine hashes the target and blob, stamps `content_hash`, and
 * `findCachedTranscript` answers from the org's completed rows (0.4 read the
 * hash off Convex `_storage`; an `s3:` ref has no such system row).
 */

const DICTATION_TIMEOUT_MS = 60_000;
const MAX_DICTATION_BYTES = 8 * 1024 * 1024;
/** The longest a dictation may hold its length: its one request's timeout,
 * with room to spare. */
const DICTATION_CALL_MAX_MS = 2 * 60 * 1000;
/** The fewest bytes a second of recorded speech takes (16 kbit/s, below
 * what a browser's recorder writes): a clip whose length cannot be read is
 * held at its size over this — never shorter than it can be. */
const MIN_DICTATION_BYTES_PER_SECOND = 2_000;

// ------------------------------------------------------------ row verbs

interface TranscriptionRowPatch {
  transcriptionStatus?: string;
  transcript?: string;
  transcriptionDurationSec?: number;
  transcriptionProgress?: string;
  transcriptionError?: string;
  /** Why a failed transcription failed, for the video-link job that handed
   * its audio over (`budgetExceeded`); not stored on the file row. */
  transcriptionErrorCode?: string;
  contentHash?: string;
}

/** Write the patch; false when nothing changed — a completion never lands
 * on a recording that was removed (`skipped`) while it was transcribed. */
async function applyTranscriptionPatch(
  db: Sql | TransactionSql,
  storageRef: string,
  patch: TranscriptionRowPatch,
): Promise<boolean> {
  const rows = await db<{ id: string }[]>`
    UPDATE app.file_metadata SET
      transcription_status = ${patch.transcriptionStatus !== undefined ? patch.transcriptionStatus : db.unsafe('transcription_status')},
      transcript = ${patch.transcript !== undefined ? patch.transcript : db.unsafe('transcript')},
      transcription_duration_sec = ${patch.transcriptionDurationSec !== undefined ? patch.transcriptionDurationSec : db.unsafe('transcription_duration_sec')},
      transcription_progress = ${patch.transcriptionProgress !== undefined ? patch.transcriptionProgress : db.unsafe('transcription_progress')},
      transcription_error = ${patch.transcriptionError !== undefined ? patch.transcriptionError : db.unsafe('transcription_error')},
      content_hash = ${patch.contentHash !== undefined ? patch.contentHash : db.unsafe('content_hash')},
      status_changed_at_ms = ${patch.transcriptionStatus !== undefined ? Date.now() : db.unsafe('status_changed_at_ms')}
    WHERE storage_ref = ${storageRef}
      AND (${patch.transcriptionStatus !== 'completed'}
           OR transcription_status IS DISTINCT FROM 'skipped')
    RETURNING id
  `;
  return rows.length > 0;
}

async function updateFileTranscription(
  sql: Sql,
  storageRef: string,
  patch: TranscriptionRowPatch,
): Promise<void> {
  const status = patch.transcriptionStatus;
  if (status !== 'completed' && status !== 'failed' && status !== 'skipped') {
    await applyTranscriptionPatch(sql, storageRef, patch);
    return;
  }
  // A terminal transcription settles the video-link job that handed off to
  // this blob IN THE SAME TRANSACTION — the missing transition that left
  // whisper jobs parked in 'transcribing_handoff' forever (holding an org
  // ingest slot each and making the chip's Retry 409).
  await sql.begin(async (tx) => {
    if (!(await applyTranscriptionPatch(tx, storageRef, patch))) return;
    await settleHandoffJobsByStorageRef(tx, {
      storageId: storageRef,
      transcriptionStatus: status,
      ...(patch.transcriptionError !== undefined
        ? { errorMessage: patch.transcriptionError }
        : {}),
      ...(patch.transcriptionErrorCode !== undefined
        ? { reasonCode: patch.transcriptionErrorCode }
        : {}),
    });
  });
}

/**
 * Claim the single-flight transcription lease (the engine's
 * `acquireTranscriptionLock`): CAS on a free/expired lease AND a claimable
 * status. Winning the claim IS the `running` transition — the status,
 * `transcription_started_at_ms`, and the staleness clock are stamped in the
 * same statement, which is what makes the crash watchdog's predicate
 * (`running` + stale `started_at`) reachable at all: a runner that dies
 * mid-transcription leaves a row the sweep recognizes instead of a
 * forever-`queued` one nothing will ever touch. The status guard also means
 * a skip/fail that lands between the engine's pre-check and its claim
 * refuses the claim instead of being resurrected to `running`.
 * Returns the winning run's id (the caller compares against its own).
 * `backend/integration-check.ts` reads it through a cast, so the proof can
 * also run against a tree that predates it. @public
 */
export async function acquireTranscriptionLease(
  sql: Sql,
  args: { storageRef: string; runId: string; leaseMs: number },
): Promise<string | null> {
  const now = Date.now();
  const rows = await sql<{ runId: string }[]>`
    UPDATE app.file_metadata SET
      transcription_run_id = ${args.runId},
      transcription_lease_expires_at_ms = ${now + args.leaseMs},
      transcription_status = 'running',
      transcription_started_at_ms = ${now},
      status_changed_at_ms = ${now}
    WHERE storage_ref = ${args.storageRef}
      AND transcription_status IN ('queued', 'running')
      AND (transcription_run_id IS NULL
           OR transcription_lease_expires_at_ms IS NULL
           OR transcription_lease_expires_at_ms < ${now})
    RETURNING transcription_run_id AS "runId"
  `;
  if (rows[0]) return rows[0].runId;
  const holders = await sql<{ runId: string | null }[]>`
    SELECT transcription_run_id AS "runId" FROM app.file_metadata
    WHERE storage_ref = ${args.storageRef} LIMIT 1
  `;
  return holders[0]?.runId ?? null;
}

// ------------------------------------------------------------- crawl host

/** The handler map the reused upload pipeline dispatches through.
 * Exported for tests only; production reaches it through the job. */
export function transcriptionHandlers(sql: Sql): ShimHandlers {
  return {
    ...chatShimHandlers(sql),
    'file_metadata/internal_queries:getByStorageId': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the engine passes exactly this shape
      const args = raw as { storageId: string };
      const rows = await sql<
        {
          transcriptionStatus: string | null;
          source: string | null;
          uploadedBy: string | null;
          fileName: string;
          contentType: string;
        }[]
      >`
        SELECT transcription_status AS "transcriptionStatus", source,
               uploaded_by AS "uploadedBy", file_name AS "fileName",
               content_type AS "contentType"
        FROM app.file_metadata
        WHERE storage_ref = ${args.storageId}
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      return {
        transcriptionStatus: row.transcriptionStatus ?? undefined,
        source: row.source ?? undefined,
        uploadedBy: row.uploadedBy ?? undefined,
        fileName: row.fileName,
        contentType: row.contentType,
      };
    },
    // The org's completed transcript for this target and these exact bytes,
    // if any other blob carried them. A transcript never crosses
    // organizations, however identical the audio.
    'file_metadata/internal_queries:findCachedTranscript': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the engine passes exactly this shape
      const args = raw as {
        organizationId: string;
        contentHash: string;
        excludeStorageId: string;
      };
      const rows = await sql<
        {
          storageId: string;
          transcript: string;
          transcriptionDurationSec: number | null;
        }[]
      >`
        SELECT storage_ref AS "storageId", transcript,
               transcription_duration_sec AS "transcriptionDurationSec"
        FROM app.file_metadata
        WHERE org_id = ${args.organizationId}
          AND content_hash = ${args.contentHash}
          AND transcription_status = 'completed'
          AND transcript IS NOT NULL
          AND storage_ref <> ${args.excludeStorageId}
        ORDER BY created_at_ms DESC
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      return {
        storageId: row.storageId,
        transcript: row.transcript,
        transcriptionDurationSec: row.transcriptionDurationSec ?? 0,
      };
    },
    'file_metadata/internal_mutations:updateFileTranscription': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the engine passes exactly this shape
      const args = raw as { storageId: string } & TranscriptionRowPatch;
      const { storageId, ...patch } = args;
      await updateFileTranscription(sql, storageId, patch);
      return null;
    },
    'file_metadata/internal_mutations:acquireTranscriptionLock': async (
      raw,
    ) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the engine passes exactly this shape
      const args = raw as { storageId: string; runId: string; leaseMs: number };
      return acquireTranscriptionLease(sql, {
        storageRef: args.storageId,
        runId: args.runId,
        leaseMs: args.leaseMs,
      });
    },
    'file_metadata/internal_mutations:releaseTranscriptionLock': async (
      raw,
    ) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the engine passes exactly this shape
      const args = raw as { storageId: string; runId: string };
      await sql`
        UPDATE app.file_metadata SET
          transcription_run_id = NULL,
          transcription_lease_expires_at_ms = NULL
        WHERE storage_ref = ${args.storageId}
          AND transcription_run_id = ${args.runId}
      `;
      return null;
    },
    'video_links/internal_mutations:heartbeatJobByStorageId': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the pipeline passes exactly this shape
      const args = raw as { storageId: string; progress?: string };
      await heartbeatJobByStorageRef(sql, args);
      return null;
    },
    // The transcription is the uploader's spend: its whole length is held
    // before the provider hears it, and the minutes it transcribed booked
    // after (transcription-metering.ts).
    'file_metadata/internal_mutations:openTranscriptionCall': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the pipeline passes exactly this shape
      const args = raw as TranscriptionModelFacts & {
        storageId: string;
        audioDurationSec: number;
      };
      const subject = await uploadTranscriptionSubject(sql, args);
      if (subject === null) {
        return {
          allowed: false,
          cancelled: true,
          reason:
            'The recording was removed before its transcription could start.',
        };
      }
      return openTranscriptionCall(sql, { ...args, subject });
    },
    'file_metadata/internal_mutations:settleTranscriptionCall': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the pipeline passes exactly this shape
      const args = raw as Parameters<typeof settleTranscriptionCall>[1];
      await settleTranscriptionCall(sql, args);
      return null;
    },
    'file_metadata/internal_mutations:releaseTranscriptionCall': async (
      raw,
    ) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the pipeline passes exactly this shape
      const args = raw as Parameters<typeof releaseTranscriptionCall>[1];
      await releaseTranscriptionCall(sql, args);
      return null;
    },
  };
}

function transcriptionScheduler(sql: Sql): ShimScheduler {
  return async (name, delayMs, args) => {
    if (name === 'file_metadata/transcribe_audio:transcribeAudio') {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the engine self-retries with exactly this shape
      const payload = args as {
        storageId: string;
        fileName: string;
        contentType: string;
        organizationId: string;
        attempt?: number;
      };
      await addJobInTx(
        sql,
        'files.transcribe',
        payload,
        delayMs > 0 ? { startAfter: new Date(Date.now() + delayMs) } : {},
      );
      return;
    }
    throw new Error(`[transcription] unmapped scheduled ref: ${name}`);
  };
}

// -------------------------------------------------------------------- jobs

/** One transcription attempt (the reused pipeline body). */
export async function runTranscribeJob(
  sql: Sql,
  payload: {
    storageId: string;
    fileName: string;
    contentType: string;
    organizationId: string;
    attempt?: number;
  },
): Promise<void> {
  const ctx = createCtxShim(transcriptionHandlers(sql), {
    scheduler: transcriptionScheduler(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reused pipeline's ActionCtx surface is exactly what the shim provides
  await transcribeAudioImpl(ctx as never, payload);
}

/**
 * Queue transcription for a freshly registered audio/video upload (the 0.4
 * `saveFileMetadata` audio branch): stamp `queued` + enqueue the job.
 *
 * Only a row THIS call moved into `queued` gets a job. A row that is already
 * queued, running, or terminal has its own lifecycle — a job in flight, the
 * retry door — and a second job would at best be wasted and at worst a
 * second attempt at paid work. Answers whether a job was enqueued.
 */
export async function queueTranscription(
  sql: Sql,
  args: {
    organizationId: string;
    storageRef: string;
    fileName: string;
    contentType: string;
  },
): Promise<boolean> {
  const stamped = await sql<{ id: string }[]>`
    UPDATE app.file_metadata SET
      transcription_status = 'queued',
      status_changed_at_ms = ${Date.now()}
    WHERE org_id = ${args.organizationId} AND storage_ref = ${args.storageRef}
      AND transcription_status IS NULL
    RETURNING id
  `;
  if (stamped.length === 0) return false;
  await addJobInTx(sql, 'files.transcribe', {
    storageId: args.storageRef,
    fileName: args.fileName,
    contentType: args.contentType,
    organizationId: args.organizationId,
  });
  return true;
}

// ------------------------------------------------------------ user actions

/** Skip an in-flight transcription (the 0.4 `skipTranscription`): only a
 * `queued`/`running` row can be skipped; the engine's phase re-checks bail.
 * A video-link job waiting on the blob settles to `skipped` with it. */
export async function skipTranscription(
  sql: Sql,
  organizationId: string,
  storageRef: string,
): Promise<void> {
  const skipped = await sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      UPDATE app.file_metadata SET
        transcription_status = 'skipped', transcription_progress = '',
        status_changed_at_ms = ${Date.now()}
      WHERE org_id = ${organizationId} AND storage_ref = ${storageRef}
        AND transcription_status IN ('queued', 'running')
      RETURNING id
    `;
    if (rows.length === 0) return false;
    await settleHandoffJobsByStorageRef(tx, {
      storageId: storageRef,
      transcriptionStatus: 'skipped',
    });
    return true;
  });
  if (!skipped) {
    throw new FileError(
      'TRANSCRIPTION_NOT_SKIPPABLE',
      'Transcription is not in a skippable state',
      400,
    );
  }
}

/** Retry from a terminal failure (the 0.4 `retryTranscription`): only
 * `failed`/`skipped` retry — `running` would double-bill, `completed`
 * would clobber the transcript. Clears the single-flight lock. */
export async function retryTranscription(
  sql: Sql,
  organizationId: string,
  storageRef: string,
): Promise<void> {
  const rows = await sql<{ fileName: string; contentType: string }[]>`
    UPDATE app.file_metadata SET
      transcription_status = 'queued', transcription_error = NULL,
      transcription_run_id = NULL, transcription_lease_expires_at_ms = NULL,
      status_changed_at_ms = ${Date.now()}
    WHERE org_id = ${organizationId} AND storage_ref = ${storageRef}
      AND transcription_status IN ('failed', 'skipped')
    RETURNING file_name AS "fileName", content_type AS "contentType"
  `;
  const row = rows[0];
  if (!row) {
    throw new FileError(
      'TRANSCRIPTION_NOT_RETRYABLE',
      'Transcription is not in a retryable state',
      400,
    );
  }
  await addJobInTx(sql, 'files.transcribe', {
    storageId: storageRef,
    fileName: row.fileName,
    contentType: row.contentType,
    organizationId,
  });
}

/**
 * One-shot dictation transcription (the 0.4 `transcribeDictation`): inline
 * bytes, no persistence — a storage ref here would let any member
 * transcribe blobs they didn't upload. The route gates membership.
 */
export async function transcribeDictation(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    audio: Uint8Array;
    mimeType: string;
  },
): Promise<{ text: string }> {
  if (args.audio.byteLength === 0) return { text: '' };
  if (args.audio.byteLength > MAX_DICTATION_BYTES) {
    throw new FileError(
      'DICTATION_TOO_LARGE',
      `Dictation audio exceeds ${MAX_DICTATION_BYTES} bytes`,
      400,
    );
  }

  const shim = createCtxShim(chatShimHandlers(sql));
  const modelData = await resolveTranscriptionModel(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 resolver; every ctx facility it touches is covered by chatShimHandlers
    shim as never,
    { organizationId: args.organizationId },
  );
  // Defense-in-depth: re-check host policy at request time so a provider
  // file edited to point at an internal host cannot exfiltrate the bearer
  // token (mirrors TTS / the upload pipeline).
  checkProviderHostPolicy(modelData.baseUrl);

  const ext = pickExtensionFromMime(args.mimeType);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a Uint8Array is a valid BlobPart at runtime
  const audioBlob = new Blob([args.audio as BlobPart], {
    type: args.mimeType,
  });
  const fileName = `dictation.${ext}`;
  // A dictation is the dictating member's spend: its length is held
  // before the provider hears it, and refused when a limit has too little
  // room for it. The length is read off the clip itself; when its container
  // names none, the longest the clip's size allows stands in.
  const model = {
    organizationId: args.organizationId,
    provider: modelData.providerName,
    model: modelData.modelId,
    ...(modelData.centsPerAudioMinute !== undefined
      ? { centsPerAudioMinute: modelData.centsPerAudioMinute }
      : {}),
  };
  const probedSec = await probeAudioDurationSec(audioBlob, fileName).catch(
    (error: unknown) => {
      console.warn('[dictation] reading the clip length failed:', error);
      return 0;
    },
  );
  const heldSec =
    probedSec > 0
      ? probedSec
      : args.audio.byteLength / MIN_DICTATION_BYTES_PER_SECOND;
  const admission = await openTranscriptionCall(sql, {
    ...model,
    subject: { userId: args.userId, agentSlug: TRANSCRIPTION_SLUG },
    audioDurationSec: heldSec,
    maxDurationMs: DICTATION_CALL_MAX_MS,
  });
  if (!admission.allowed) {
    throw new FileError('BUDGET_EXCEEDED', admission.reason, 429);
  }
  let result: Awaited<ReturnType<typeof requestTranscription>>;
  try {
    result = await requestTranscription({
      model: modelData,
      blob: audioBlob,
      fileName,
      timeoutMs: DICTATION_TIMEOUT_MS,
    });
  } catch (error) {
    await releaseTranscriptionCall(sql, { lease: admission.lease }).catch(
      (releaseError: unknown) => {
        console.warn(
          "[dictation] releasing the call's hold failed; it lapses at its deadline:",
          releaseError,
        );
      },
    );
    throw error;
  }

  const text = result.text ?? '';
  // What the provider reports it heard, else the clip's own length — else
  // the longest its size allows, never nothing for minutes it was billed.
  const durationSec = result.duration ?? heldSec;
  await settleTranscriptionCall(sql, {
    ...model,
    lease: admission.lease,
    audioDurationSec: durationSec,
  }).catch((error: unknown) => {
    console.warn('[dictation] usage write failed:', error);
  });
  return { text };
}
