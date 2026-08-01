'use node';

import { v } from 'convex/values';

import { TRANSCRIPTION_SLUG } from '../../lib/shared/constants/usage';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import { estimateTranscriptionCostCents } from '../governance/cost_estimation';
import { classifyTranscriptionError } from '../lib/errors/classify_transcription_error';
import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import { checkProviderHostPolicy } from '../lib/http/host_policy';
import { resolveTranscriptionModel } from '../lib/providers/resolve_transcription_model';
import { readBlobBytes } from '../lib/storage/blob_access';
import { blobRefValidator, convexStorageId } from '../lib/storage/blob_ref';
import {
  chunkCompressedAudio,
  compressAudio,
  CHUNK_TRIGGER_BYTES,
  type AudioChunk,
  type CompressedAudio,
} from './audio_preprocess';
import {
  joinSegmentsWithParagraphs,
  WHISPER_PROFILE,
  type ParagraphSegment,
} from './paragraphize';
import {
  requestTranscription,
  type TranscriptionSegment,
} from './transcription_request';

/** Matches EXTRACT_METADATA_RETRY_DELAYS in internal_actions.ts — consistent
 * backoff pattern across the scheduled-action family. */
const TRANSCRIBE_RETRY_DELAYS_MS = [30_000, 60_000, 120_000];

/** Per-chunk API timeout. Covers long OpenAI transcriptions on ~21 MB chunks
 * (empirically 30–90s). */
const TRANSCRIBE_API_TIMEOUT_MS = 5 * 60_000;

/**
 * Adapter: Whisper `verbose_json` segments → shared `ParagraphSegment` shape.
 * Optionally offsets timestamps by `chunkStartSec` so the absolute position
 * in the original audio is preserved across chunks (each chunk's Whisper
 * response uses chunk-local 0:00 timestamps because we splice with
 * `-reset_timestamps 1`).
 */
function whisperSegmentsToParagraphSegments(
  segments: TranscriptionSegment[] | undefined,
  chunkStartSec: number,
): ParagraphSegment[] {
  if (!segments) return [];
  return segments.map((s) => ({
    startSec: s.start + chunkStartSec,
    endSec: s.end + chunkStartSec,
    text: s.text,
  }));
}

/**
 * The prose inside an error, for a field a person reads.
 *
 * A `ConvexError` carrying a structured payload stringifies its whole payload
 * into `.message`, so the plain `err.message` path stored
 * `{"code":"NO_TRANSCRIPTION_MODEL","message":"No transcription model is
 * configured for this organization."}` — raw JSON — into `transcriptionError`.
 * Prefer the payload's own `message` when there is one.
 */
function readableMessage(err: unknown): string {
  if (err !== null && typeof err === 'object' && 'data' in err) {
    const data = (err as { data: unknown }).data;
    if (typeof data === 'string' && data.length > 0) return data;
    if (data !== null && typeof data === 'object' && 'message' in data) {
      const message = (data as { message: unknown }).message;
      if (typeof message === 'string' && message.length > 0) return message;
    }
  }
  const base = err instanceof Error ? err.message : String(err);
  // undici reports every transport failure as the bare string `fetch failed`
  // and puts the actual reason (ENOTFOUND, ECONNREFUSED, a TLS error) on
  // `cause`. Without it the row — and the operator reading it — cannot tell a
  // DNS problem from a blocked egress from a dead endpoint.
  const cause = err instanceof Error ? err.cause : undefined;
  if (cause !== undefined && cause !== null) {
    let detail: string;
    if (cause instanceof Error) {
      const code = 'code' in cause ? cause.code : undefined;
      detail =
        typeof code === 'string' ? `${code}: ${cause.message}` : cause.message;
    } else {
      detail = String(cause);
    }
    if (detail.length > 0 && !base.includes(detail)) {
      return `${base} (${detail})`;
    }
  }
  return base;
}

/**
 * Scrub secrets from error messages before they land in user-visible
 * `transcriptionError` or logs. Targets OpenAI-style tokens and generic
 * Authorization headers; truncates to 500 chars.
 */
function sanitizeTranscriptionError(err: unknown): string {
  const raw = readableMessage(err);
  return (
    raw
      .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
      .replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-[REDACTED]')
      // The optional second token matters: a scheme-only redaction turns
      // `Authorization: Basic dXNlcjpwYXNz` into
      // `Authorization: [REDACTED] dXNlcjpwYXNz` — the header is hidden and the
      // credential is not.
      .replace(
        /Authorization:\s*\S+(?:\s+[A-Za-z0-9._~+/=-]+)?/gi,
        'Authorization: [REDACTED]',
      )
      .slice(0, 500)
  );
}

/**
 * Whisper validates by file extension, and our compressed output is
 * Opus-in-OGG, so the `multipart` `file` field must use `.ogg` (`.opus` is NOT
 * in OpenAI's accepted list even though the content is identical). The same
 * `'ogg'` value feeds the `json-base64` `input_audio.format` field.
 * https://platform.openai.com/docs/guides/speech-to-text
 */
function chunkFileName(originalFileName: string, chunk: AudioChunk): string {
  return chunk.index === 0 && chunk.durationSec > 0
    ? `${originalFileName}.ogg`
    : `${originalFileName}.chunk-${chunk.index}.ogg`;
}

async function patchProgress(
  ctx: ActionCtx,
  storageId: string,
  progress: string,
): Promise<void> {
  await ctx.runMutation(
    internal.file_metadata.internal_mutations.updateFileTranscription,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- storageId is branded Id<'_storage'> from args
    { storageId: storageId as never, transcriptionProgress: progress },
  );
}

/**
 * Transcribe an uploaded audio/video file via the org's configured
 * transcription provider. Server-side pipeline:
 *
 *   1. Compress with ffmpeg (silenceremove + 32 kbps Opus mono 16 kHz)
 *   2. If compressed output still exceeds OpenAI's 25 MB limit, split into
 *      90-minute chunks via stream-copy segment (no re-encode).
 *   3. POST each chunk sequentially to {baseUrl}/audio/transcriptions.
 *   4. Join transcripts with blank-line separator.
 *   5. Record usage to the ledger.
 *
 * Transcript RAG indexing (indexing the text under the audio's storageId so
 * `rag_search` can cite the clip) is a deliberate follow-up — the retired
 * `uploadFile` helper is gone, and chat usefulness only needs the transcript
 * on `fileMetadata` for the turn to inject. `transcriptRagStatus` stays unset.
 *
 * On transient failure (429, 5xx, network): classify via
 * `classifyTranscriptionError`, retry the whole action up to 3 times with
 * [30s, 60s, 120s] backoff. Permanent failures (auth, bad input, no model)
 * fail fast. Failures always land on the row through
 * `updateFileTranscription` — callers schedule this fire-and-forget, so a
 * bare throw would leave the row stuck at `queued`/`running`.
 */
export const transcribeAudio = internalAction({
  args: {
    // Audio blob reference: a Convex `_storage` id (deployment default) OR an
    // `s3:<key>` ref when the org has a bring-your-own bucket. The source read
    // (below) routes off the backend via `readBlobBytes`; the Convex path is
    // byte-for-byte unchanged.
    storageId: blobRefValidator,
    fileName: v.string(),
    contentType: v.string(),
    organizationId: v.string(),
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const attempt = args.attempt ?? 0;
    const requestId = `transcribe-${args.storageId}-${Date.now()}`;
    const startedAt = Date.now();

    const orgSlug = await orgSlugFromIdOrNull(ctx, args.organizationId);

    let compressed: CompressedAudio | undefined;
    let chunked:
      | { chunks: AudioChunk[]; cleanup: () => Promise<void> }
      | undefined;

    // Early-exit check: user may have cancelled (removed the attachment or
    // clicked Skip) between this action being scheduled and firing. Skip all
    // work — no compress, no API call, no reschedule.
    const preCheck = await ctx.runQuery(
      internal.file_metadata.internal_queries.getByStorageId,
      { storageId: args.storageId },
    );
    if (
      !preCheck ||
      preCheck.transcriptionStatus === 'skipped' ||
      preCheck.transcriptionStatus === 'failed'
    ) {
      console.log(
        JSON.stringify({
          event: 'transcription.cancelled',
          requestId,
          storageId: args.storageId,
          status: preCheck?.transcriptionStatus ?? 'row_missing',
          attempt,
        }),
      );
      return null;
    }

    // Single-flight gate. Two concurrent invocations on the same
    // storageId (retryTranscription double-click, scheduled retry +
    // user-triggered retry, etc.) used to both proceed: double Whisper
    // bill, double `+=` ledger write. The lock holds for the action's
    // 30-min hard timeout + a small grace so the watchdog can break it
    // if Convex SIGKILLs us. If we lose the race, return without work.
    const TRANSCRIBE_LEASE_MS = 35 * 60 * 1000;
    const acquired = await ctx.runMutation(
      internal.file_metadata.internal_mutations.acquireTranscriptionLock,
      {
        storageId: args.storageId,
        runId: requestId,
        leaseMs: TRANSCRIBE_LEASE_MS,
      },
    );
    if (acquired !== requestId) {
      console.log(
        JSON.stringify({
          event: 'transcription.deduplicated',
          requestId,
          storageId: args.storageId,
          attempt,
        }),
      );
      return null;
    }

    try {
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.updateFileTranscription,
        {
          storageId: args.storageId,
          transcriptionProgress: 'checking',
        },
      );

      // Dedup: Convex stores a SHA-256 of every upload on `_storage`. If the
      // same content was already transcribed in this org, short-circuit and
      // copy the prior transcript rather than paying ffmpeg + OpenAI again.
      // An `s3:` ref has no `_storage` system row, so the checksum is
      // unavailable — dedup gracefully degrades to off for BYO-bucket orgs.
      const audioConvexId = convexStorageId(args.storageId);
      const contentHash = audioConvexId
        ? await ctx.runQuery(
            internal.file_metadata.internal_queries.getStorageSha256,
            { storageId: audioConvexId },
          )
        : null;

      if (contentHash) {
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileTranscription,
          { storageId: args.storageId, contentHash },
        );

        const cached = await ctx.runQuery(
          internal.file_metadata.internal_queries.findCachedTranscript,
          {
            organizationId: args.organizationId,
            contentHash,
            excludeStorageId: args.storageId,
          },
        );
        if (cached) {
          console.log(
            JSON.stringify({
              event: 'transcription.dedup_hit',
              requestId,
              storageId: args.storageId,
              sourceStorageId: cached.storageId,
              contentHash,
              durationSec: cached.transcriptionDurationSec,
            }),
          );
          await ctx.runMutation(
            internal.file_metadata.internal_mutations.updateFileTranscription,
            {
              storageId: args.storageId,
              transcriptionStatus: 'completed',
              transcript: cached.transcript,
              transcriptionDurationSec: cached.transcriptionDurationSec,
              transcriptionProgress: '',
            },
          );
          return null;
        }
      }

      await patchProgress(ctx, args.storageId, 'compressing');

      const modelData = await resolveTranscriptionModel(ctx, {
        organizationId: args.organizationId,
      });
      // Defense-in-depth: re-check host policy at request time so a provider
      // file edited to point at an internal host cannot exfiltrate the bearer
      // token (mirrors dictation / TTS).
      checkProviderHostPolicy(modelData.baseUrl);

      let origBlob: Blob;
      if (audioConvexId) {
        const b = await ctx.storage.get(audioConvexId);
        if (!b) {
          throw new Error(`Audio blob not found in storage: ${args.storageId}`);
        }
        origBlob = b;
      } else {
        if (orgSlug === null) {
          throw new Error(
            `[transcribeAudio] org ${args.organizationId} unresolvable; cannot read S3 audio blob ${args.storageId}`,
          );
        }
        const bytes = await readBlobBytes(ctx, orgSlug, args.storageId);
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a Uint8Array is a valid BlobPart at runtime (TS 5.7 ArrayBufferLike variance)
        origBlob = new Blob([bytes as BlobPart], {
          type: args.contentType || 'application/octet-stream',
        });
      }

      compressed = await compressAudio(origBlob, args.fileName);

      let chunks: AudioChunk[];
      if (compressed.sizeBytes > CHUNK_TRIGGER_BYTES) {
        chunked = await chunkCompressedAudio(compressed.blob);
        chunks = chunked.chunks;
      } else {
        chunks = [
          {
            blob: compressed.blob,
            durationSec: compressed.durationSec,
            index: 0,
          },
        ];
      }

      if (chunks.length === 0) {
        throw new Error('Compression produced no output audio');
      }

      const chunkParagraphs: string[] = [];
      let totalDurationSec = 0;
      let chunkStartSec = 0;
      for (const chunk of chunks) {
        const progressLabel =
          chunks.length === 1
            ? 'transcribing'
            : `transcribing chunk ${chunk.index + 1} of ${chunks.length}`;
        await patchProgress(ctx, args.storageId, progressLabel);

        const result = await requestTranscription({
          model: modelData,
          blob: chunk.blob,
          fileName: chunkFileName(args.fileName, chunk),
          format: 'ogg',
          timeoutMs: TRANSCRIBE_API_TIMEOUT_MS,
        });
        // Timestamps are only meaningful for video-link transcripts —
        // they let the agent cite "Chapter 3 @ 12:34" in summaries.
        // Regular microphone recordings don't carry that context, so
        // adding [HH:MM:SS] prefixes there changes the artifact format
        // for every user with no upside. Gate on the source: only
        // video-link-sourced fileMetadata rows opt in.
        const paragraphs = joinSegmentsWithParagraphs(
          whisperSegmentsToParagraphSegments(result.segments, chunkStartSec),
          result.text ?? '',
          {
            profile: WHISPER_PROFILE,
            addTimestamps: preCheck?.source === 'video_link',
          },
        );
        if (paragraphs.length > 0) {
          chunkParagraphs.push(paragraphs);
        }
        const chunkDuration = result.duration ?? chunk.durationSec;
        totalDurationSec += chunkDuration;
        chunkStartSec += chunkDuration;

        // Heartbeat any video-link job that's tracking this storageId so its
        // statusChangedAt advances past the watchdog window.
        await ctx.runMutation(
          internal.video_links.internal_mutations.heartbeatJobByStorageId,
          {
            storageId: args.storageId,
            progress: progressLabel,
          },
        );
      }

      const fullTranscript = chunkParagraphs.join('\n\n');

      await ctx.runMutation(
        internal.file_metadata.internal_mutations.updateFileTranscription,
        {
          storageId: args.storageId,
          transcriptionStatus: 'completed',
          transcript: fullTranscript,
          transcriptionDurationSec: totalDurationSec,
          transcriptionProgress: '',
        },
      );

      const latencyMs = Date.now() - startedAt;
      console.log(
        JSON.stringify({
          event: 'transcription.completed',
          requestId,
          storageId: args.storageId,
          organizationId: args.organizationId,
          provider: modelData.providerName,
          model: modelData.modelId,
          durationSec: totalDurationSec,
          chunkCount: chunks.length,
          compressedBytes: compressed.sizeBytes,
          attempt,
          latencyMs,
        }),
      );

      const metadata = await ctx.runQuery(
        internal.file_metadata.internal_queries.getByStorageId,
        { storageId: args.storageId },
      );
      const userId = metadata?.uploadedBy;
      if (userId && totalDurationSec > 0) {
        // The rewritten catalog schema carries no per-minute transcription
        // price, so the estimate is 0 until it grows one — the ledger still
        // records the audio minutes and the request.
        const costEstimateCents = estimateTranscriptionCostCents(
          totalDurationSec,
          undefined,
        );
        await ctx.runMutation(
          internal.governance.internal_mutations.recordTranscriptionUsage,
          {
            organizationId: args.organizationId,
            userId,
            agentSlug: TRANSCRIPTION_SLUG,
            model: modelData.modelId,
            provider: modelData.providerName,
            audioDurationSec: totalDurationSec,
            costEstimateCents,
            timestamp: Date.now(),
          },
        );
      }

      return null;
    } catch (error) {
      const classification = classifyTranscriptionError(error);
      const sanitized = sanitizeTranscriptionError(error);

      const rawStack =
        error instanceof Error && error.stack
          ? sanitizeTranscriptionError(error.stack)
          : undefined;

      const cancelCheck = await ctx.runQuery(
        internal.file_metadata.internal_queries.getByStorageId,
        { storageId: args.storageId },
      );
      const userCancelled =
        cancelCheck?.transcriptionStatus === 'skipped' || cancelCheck === null;

      if (
        !userCancelled &&
        classification.shouldRetry &&
        attempt < TRANSCRIBE_RETRY_DELAYS_MS.length
      ) {
        const delay = TRANSCRIBE_RETRY_DELAYS_MS[attempt] ?? 30_000;
        console.error(
          JSON.stringify({
            event: 'transcription.retrying',
            requestId,
            storageId: args.storageId,
            organizationId: args.organizationId,
            attempt,
            delayMs: delay,
            errorClass: 'retryable',
            errorCode: classification.reason,
            errorMessage: sanitized,
            errorStack: rawStack,
          }),
        );
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileTranscription,
          {
            storageId: args.storageId,
            transcriptionStatus: 'queued',
            transcriptionProgress: `retrying in ${Math.round(delay / 1000)}s`,
          },
        );
        await ctx.scheduler.runAfter(
          delay,
          internal.file_metadata.transcribe_audio.transcribeAudio,
          {
            storageId: args.storageId,
            fileName: args.fileName,
            contentType: args.contentType,
            organizationId: args.organizationId,
            attempt: attempt + 1,
          },
        );
        return null;
      }

      if (userCancelled) {
        console.log(
          JSON.stringify({
            event: 'transcription.cancelled',
            requestId,
            storageId: args.storageId,
            status: cancelCheck?.transcriptionStatus ?? 'row_missing',
            attempt,
            errorMessage: sanitized,
          }),
        );
        return null;
      }

      console.error(
        JSON.stringify({
          event: 'transcription.failed',
          requestId,
          storageId: args.storageId,
          organizationId: args.organizationId,
          attempt,
          latencyMs: Date.now() - startedAt,
          errorClass: classification.shouldRetry ? 'retryable' : 'permanent',
          errorCode: classification.reason,
          errorMessage: sanitized,
          errorStack: rawStack,
        }),
      );
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.updateFileTranscription,
        {
          storageId: args.storageId,
          transcriptionStatus: 'failed',
          transcriptionError: sanitized,
          transcriptionProgress: '',
        },
      );
      return null;
    } finally {
      if (compressed) {
        await compressed.cleanup();
      }
      if (chunked) {
        await chunked.cleanup();
      }
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.releaseTranscriptionLock,
        { storageId: args.storageId, runId: requestId },
      );
    }
  },
});
