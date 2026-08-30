import type { Sql, TransactionSql } from 'postgres';

import { transcribeAudioImpl } from '../../../convex/file_metadata/transcribe_audio.ts';
import { pickExtensionFromMime } from '../../../convex/file_metadata/transcribe_dictation.ts';
import { requestTranscription } from '../../../convex/file_metadata/transcription_request.ts';
import { estimateTranscriptionCostCents } from '../../../convex/governance/cost_estimation.ts';
import { checkProviderHostPolicy } from '../../../convex/lib/http/host_policy.ts';
import { resolveTranscriptionModel } from '../../../convex/lib/providers/resolve_transcription_model.ts';
import { TRANSCRIPTION_SLUG } from '../../../lib/shared/constants/usage.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  createCtxShim,
  type ShimHandlers,
  type ShimScheduler,
} from '../../lib/convex-shim.ts';
import { chatShimHandlers } from '../chat/shim.ts';
import { incrementUsageLedger } from '../governance/service.ts';
import { heartbeatJobByStorageRef } from '../video_links/service.ts';
import { FileError } from './service.ts';

/**
 * Audio transcription — the 0.5 host for the REUSED 0.4 pipeline
 * (`transcribe_audio.ts`, hoisted): ffmpeg compress (silence-strip, Opus 32k
 * mono) → chunk when still over the provider cap → sequential
 * `/audio/transcriptions` calls → paragraphized transcript on the file row →
 * ledger minutes. The engine's ctx runs on the chat shim (the provider walk
 * `resolveTranscriptionModel` shares with TTS/dictation) plus the file-row
 * verbs below; its `[30s, 60s, 120s]` retry self-chain maps onto delayed
 * `files.transcribe` jobs. The 0.4 content-hash dedup rides Convex
 * `_storage` sha256 rows and degrades to OFF here by design (0.5 blobs are
 * `s3:` refs — the 0.4 code takes the same branch for BYO-bucket orgs).
 */

const DICTATION_TIMEOUT_MS = 60_000;
export const MAX_DICTATION_BYTES = 8 * 1024 * 1024;

// ------------------------------------------------------------ row verbs

interface TranscriptionRowPatch {
  transcriptionStatus?: string;
  transcript?: string;
  transcriptionDurationSec?: number;
  transcriptionProgress?: string;
  transcriptionError?: string;
  contentHash?: string;
}

async function updateFileTranscription(
  sql: Sql,
  storageRef: string,
  patch: TranscriptionRowPatch,
): Promise<void> {
  await sql`
    UPDATE app.file_metadata SET
      transcription_status = ${patch.transcriptionStatus !== undefined ? patch.transcriptionStatus : sql.unsafe('transcription_status')},
      transcript = ${patch.transcript !== undefined ? patch.transcript : sql.unsafe('transcript')},
      transcription_duration_sec = ${patch.transcriptionDurationSec !== undefined ? patch.transcriptionDurationSec : sql.unsafe('transcription_duration_sec')},
      transcription_progress = ${patch.transcriptionProgress !== undefined ? patch.transcriptionProgress : sql.unsafe('transcription_progress')},
      transcription_error = ${patch.transcriptionError !== undefined ? patch.transcriptionError : sql.unsafe('transcription_error')}
    WHERE storage_ref = ${storageRef}
  `;
}

// ------------------------------------------------------------- crawl host

function transcriptionHandlers(sql: Sql): ShimHandlers {
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
    // 0.5 blobs are `s3:` refs with no Convex `_storage` system row — the
    // engine never reaches these two on that branch, but the honest answers
    // keep any stray call harmless (dedup off, exactly like 0.4 BYO-bucket).
    'file_metadata/internal_queries:getStorageSha256': async () => null,
    'file_metadata/internal_queries:findCachedTranscript': async () => null,
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
      const now = Date.now();
      const rows = await sql<{ runId: string }[]>`
        UPDATE app.file_metadata SET
          transcription_run_id = ${args.runId},
          transcription_lease_expires_at_ms = ${now + args.leaseMs}
        WHERE storage_ref = ${args.storageId}
          AND (transcription_run_id IS NULL
               OR transcription_lease_expires_at_ms IS NULL
               OR transcription_lease_expires_at_ms < ${now})
        RETURNING transcription_run_id AS "runId"
      `;
      if (rows[0]) return rows[0].runId;
      const holders = await sql<{ runId: string | null }[]>`
        SELECT transcription_run_id AS "runId" FROM app.file_metadata
        WHERE storage_ref = ${args.storageId} LIMIT 1
      `;
      return holders[0]?.runId ?? null;
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
    'governance/internal_mutations:recordTranscriptionUsage': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the engine passes exactly this shape
      const args = raw as {
        organizationId: string;
        userId: string;
        teamId?: string;
        agentSlug: string;
        model: string;
        provider: string;
        audioDurationSec: number;
        costEstimateCents: number;
        timestamp: number;
      };
      await recordTranscriptionUsage(sql, args);
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

/** Ledger minutes for one transcription call (the 0.4 governance twin). */
export async function recordTranscriptionUsage(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    userId: string;
    teamId?: string;
    agentSlug: string;
    model: string;
    provider: string;
    audioDurationSec: number;
    costEstimateCents: number;
    timestamp: number;
  },
): Promise<void> {
  await incrementUsageLedger(sql, {
    organizationId: args.organizationId,
    userId: args.userId,
    ...(args.teamId !== undefined ? { teamId: args.teamId } : {}),
    agentSlug: args.agentSlug,
    model: args.model,
    provider: args.provider,
    inputTokens: 0,
    outputTokens: 0,
    costEstimateCents: args.costEstimateCents,
    timestamp: args.timestamp,
    audioDurationSec: args.audioDurationSec,
  });
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
 */
export async function queueTranscription(
  sql: Sql,
  args: {
    organizationId: string;
    storageRef: string;
    fileName: string;
    contentType: string;
  },
): Promise<void> {
  await sql`
    UPDATE app.file_metadata SET transcription_status = 'queued'
    WHERE org_id = ${args.organizationId} AND storage_ref = ${args.storageRef}
      AND transcription_status IS NULL
  `;
  await addJobInTx(sql, 'files.transcribe', {
    storageId: args.storageRef,
    fileName: args.fileName,
    contentType: args.contentType,
    organizationId: args.organizationId,
  });
}

// ------------------------------------------------------------ user actions

/** Skip an in-flight transcription (the 0.4 `skipTranscription`): only a
 * `queued`/`running` row can be skipped; the engine's phase re-checks bail. */
export async function skipTranscription(
  sql: Sql,
  organizationId: string,
  storageRef: string,
): Promise<void> {
  const rows = await sql<{ id: string }[]>`
    UPDATE app.file_metadata SET
      transcription_status = 'skipped', transcription_progress = ''
    WHERE org_id = ${organizationId} AND storage_ref = ${storageRef}
      AND transcription_status IN ('queued', 'running')
    RETURNING id
  `;
  if (rows.length === 0) {
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
      transcription_run_id = NULL, transcription_lease_expires_at_ms = NULL
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
  const result = await requestTranscription({
    model: modelData,
    blob: audioBlob,
    fileName: `dictation.${ext}`,
    format: ext,
    timeoutMs: DICTATION_TIMEOUT_MS,
  });

  const text = result.text ?? '';
  const durationSec = result.duration ?? 0;
  if (durationSec > 0) {
    await recordTranscriptionUsage(sql, {
      organizationId: args.organizationId,
      userId: args.userId,
      agentSlug: TRANSCRIPTION_SLUG,
      model: modelData.modelId,
      provider: modelData.providerName,
      audioDurationSec: durationSec,
      costEstimateCents: estimateTranscriptionCostCents(durationSec, undefined),
      timestamp: Date.now(),
    });
  }
  return { text };
}
