'use node';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import { estimateTranscriptionCostCents } from '../governance/cost_estimation';
import { classifyError } from '../lib/error_classification';
import { getRagConfig } from '../lib/helpers/rag_config';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import type { ResolvedModelData } from '../providers/resolve_model';
import { resolveTranscriptionModel } from '../providers/resolve_model';
import { uploadFile } from '../workflow_engine/action_defs/rag/helpers/upload_file_direct';
import {
  chunkCompressedAudio,
  compressAudio,
  CHUNK_TRIGGER_BYTES,
  type AudioChunk,
  type CompressedAudio,
} from './audio_preprocess';

/** Matches EXTRACT_METADATA_RETRY_DELAYS in internal_actions.ts — consistent
 * backoff pattern across the scheduled-action family. */
const TRANSCRIBE_RETRY_DELAYS_MS = [30_000, 60_000, 120_000];

/** Per-chunk API timeout. Covers long OpenAI transcriptions on ~21 MB chunks
 * (empirically 30–90s). */
const TRANSCRIBE_API_TIMEOUT_MS = 5 * 60_000;

interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

interface TranscriptionResponse {
  text: string;
  duration?: number;
  language?: string;
  segments?: TranscriptionSegment[];
}

/** Break paragraphs at pauses ≥ this many seconds between segments. */
const PARAGRAPH_PAUSE_SEC = 1.5;

/** Force a paragraph break after this many seconds of continuous speech,
 * even without a natural pause — avoids walls of text for monologue audio. */
const PARAGRAPH_MAX_DURATION_SEC = 45;

/**
 * Join whisper `verbose_json` segments into paragraphs. Inserts `\n\n` between
 * segments where either (a) the pause between them is ≥ PARAGRAPH_PAUSE_SEC,
 * or (b) the accumulated paragraph exceeds PARAGRAPH_MAX_DURATION_SEC.
 *
 * Falls back to the raw `text` field when segments are missing.
 */
function joinSegmentsWithParagraphs(
  segments: TranscriptionSegment[] | undefined,
  fallbackText: string,
): string {
  if (!segments || segments.length === 0) return fallbackText.trim();

  const paragraphs: string[] = [];
  let current: string[] = [];
  let paragraphStart = segments[0].start;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const prev = i > 0 ? segments[i - 1] : null;
    const gap = prev ? seg.start - prev.end : 0;
    const paragraphDuration = seg.end - paragraphStart;

    if (
      current.length > 0 &&
      (gap >= PARAGRAPH_PAUSE_SEC ||
        paragraphDuration >= PARAGRAPH_MAX_DURATION_SEC)
    ) {
      paragraphs.push(current.join('').trim());
      current = [];
      paragraphStart = seg.start;
    }
    current.push(seg.text);
  }
  if (current.length > 0) {
    paragraphs.push(current.join('').trim());
  }
  return paragraphs.filter((p) => p.length > 0).join('\n\n');
}

/**
 * Scrub secrets from error messages before they land in user-visible
 * `transcriptionError` or logs. Targets OpenAI-style tokens and generic
 * Authorization headers; truncates to 500 chars.
 */
function sanitizeTranscriptionError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-[REDACTED]')
    .replace(/Authorization:\s*\S+/gi, 'Authorization: [REDACTED]')
    .slice(0, 500);
}

async function postChunkToTranscriptionApi(
  modelData: ResolvedModelData,
  chunk: AudioChunk,
  originalFileName: string,
): Promise<TranscriptionResponse> {
  const formData = new FormData();
  // OpenAI and most OpenAI-compatible servers validate by file extension.
  // Our compressed output is Opus-in-OGG, so the extension must be `.ogg`
  // (`.opus` is NOT in OpenAI's accepted list even though the content is
  // identical). https://platform.openai.com/docs/guides/speech-to-text
  const chunkName =
    chunk.index === 0 && chunk.durationSec > 0
      ? `${originalFileName}.ogg`
      : `${originalFileName}.chunk-${chunk.index}.ogg`;
  formData.append('file', chunk.blob, chunkName);
  formData.append('model', modelData.modelId);
  // `verbose_json` is required to get `duration` across OpenAI, vLLM,
  // LocalAI, and faster-whisper-server. Plain `json` omits it on OpenAI.
  formData.append('response_format', 'verbose_json');

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    TRANSCRIBE_API_TIMEOUT_MS,
  );

  try {
    const response = await fetch(`${modelData.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${modelData.apiKey}` },
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      // Attach the HTTP status to the Error so `classifyError` can properly
      // mark 4xx as non-retryable (vs. 429/5xx which should retry). Without
      // this, all API errors fall into the default `unknown + retryable`
      // bucket and waste 3 retries.
      const err: Error & { status?: number } = new Error(
        `Transcription API ${response.status}: ${errorText.slice(0, 400)}`,
      );
      err.status = response.status;
      throw err;
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- OpenAI-compatible response shape
    return (await response.json()) as TranscriptionResponse;
  } finally {
    clearTimeout(timeoutId);
  }
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
 * Transcribe an uploaded audio file via the org's configured transcription
 * provider. Server-side pipeline:
 *
 *   1. Compress with ffmpeg (silenceremove + 32 kbps Opus mono 16 kHz)
 *   2. If compressed output still exceeds OpenAI's 25 MB limit, split into
 *      90-minute chunks via stream-copy segment (no re-encode).
 *   3. POST each chunk sequentially to {baseUrl}/audio/transcriptions.
 *   4. Join transcripts with blank-line separator.
 *   5. Record usage to ledger, index full transcript into RAG.
 *
 * On transient failure (429, 5xx, network): classify via classifyError, retry
 * the whole action up to 3 times with [30s, 60s, 120s] backoff. Permanent
 * failures (auth, bad input, >4h audio) fail fast.
 */
export const transcribeAudio = internalAction({
  args: {
    storageId: v.id('_storage'),
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

    try {
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.updateFileTranscription,
        {
          storageId: args.storageId,
          transcriptionStatus: 'running',
          transcriptionProgress: 'checking',
        },
      );

      // Dedup: Convex stores a SHA-256 of every upload on `_storage`. If the
      // same content was already transcribed in this org, short-circuit and
      // copy the prior transcript rather than paying ffmpeg + OpenAI again.
      const contentHash = await ctx.runQuery(
        internal.file_metadata.internal_queries.getStorageSha256,
        { storageId: args.storageId },
      );

      if (contentHash) {
        // Stamp our own row so future uploads can dedup against it too.
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
              // RAG already has this transcript indexed under the prior upload;
              // marking completed keeps UI parity without re-indexing.
              transcriptRagStatus: 'completed',
            },
          );
          return null;
        }
      }

      await patchProgress(ctx, args.storageId, 'compressing');

      const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
      const modelData = await resolveTranscriptionModel(ctx, { orgSlug });

      const origBlob = await ctx.storage.get(args.storageId);
      if (!origBlob) {
        throw new Error(`Audio blob not found in storage: ${args.storageId}`);
      }

      // Phase 1 — compress
      compressed = await compressAudio(origBlob, args.fileName);

      // Phase 2 — chunk only if needed
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

      // Phase 3 — transcribe each chunk sequentially. Each chunk's segments
      // get joined into paragraphs (pause-based breaks); chunks then join
      // into the final transcript with blank-line separators.
      const chunkParagraphs: string[] = [];
      let totalDurationSec = 0;
      for (const chunk of chunks) {
        const progressLabel =
          chunks.length === 1
            ? 'transcribing'
            : `transcribing chunk ${chunk.index + 1} of ${chunks.length}`;
        await patchProgress(ctx, args.storageId, progressLabel);

        const result = await postChunkToTranscriptionApi(
          modelData,
          chunk,
          args.fileName,
        );
        const paragraphs = joinSegmentsWithParagraphs(
          result.segments,
          result.text ?? '',
        );
        if (paragraphs.length > 0) {
          chunkParagraphs.push(paragraphs);
        }
        totalDurationSec += result.duration ?? chunk.durationSec;
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

      // Ledger entry (parity with chat). userId = the uploader; cost attributed
      // to them. Duration used is the compressed/billed duration, which is
      // what OpenAI actually charged for (silence removed → shorter).
      const metadata = await ctx.runQuery(
        internal.file_metadata.internal_queries.getByStorageId,
        { storageId: args.storageId },
      );
      const userId = metadata?.uploadedBy;
      if (userId && totalDurationSec > 0) {
        const costEstimateCents = estimateTranscriptionCostCents(
          totalDurationSec,
          modelData.centsPerAudioMinute,
        );
        await ctx.runMutation(
          internal.governance.internal_mutations.recordTranscriptionUsage,
          {
            organizationId: args.organizationId,
            userId,
            model: modelData.modelId,
            provider: modelData.providerName,
            audioDurationSec: totalDurationSec,
            costEstimateCents,
            timestamp: Date.now(),
          },
        );
      }

      // Index transcript into RAG (best-effort — RAG failure does not demote
      // the transcription itself, which is already `completed`).
      if (fullTranscript.length > 0) {
        try {
          await ctx.runMutation(
            internal.file_metadata.internal_mutations.updateFileTranscription,
            { storageId: args.storageId, transcriptRagStatus: 'running' },
          );
          const ragConfig = getRagConfig();
          if (ragConfig.serviceUrl) {
            const transcriptBlob = new Blob([fullTranscript], {
              type: 'text/plain',
            });
            await uploadFile({
              ragServiceUrl: ragConfig.serviceUrl,
              file: transcriptBlob,
              filename: `${args.fileName}.transcript.txt`,
              contentType: 'text/plain',
              fileId: args.storageId,
              metadata: {
                source: 'audio_transcript',
                originalFileName: args.fileName,
                originalContentType: args.contentType,
                chunkCount: chunks.length,
              },
            });
            await ctx.runMutation(
              internal.file_metadata.internal_mutations.updateFileTranscription,
              { storageId: args.storageId, transcriptRagStatus: 'completed' },
            );
          }
        } catch (ragError) {
          console.error(
            `[transcribeAudio:rag] requestId=${requestId} ${sanitizeTranscriptionError(ragError)}`,
          );
          await ctx.runMutation(
            internal.file_metadata.internal_mutations.updateFileTranscription,
            {
              storageId: args.storageId,
              transcriptRagStatus: 'failed',
              transcriptRagError: sanitizeTranscriptionError(ragError),
            },
          );
        }
      }

      return null;
    } catch (error) {
      const classification = classifyError(error);
      const sanitized = sanitizeTranscriptionError(error);

      const rawStack =
        error instanceof Error && error.stack
          ? sanitizeTranscriptionError(error.stack)
          : undefined;

      // Re-check cancellation before rescheduling: user may have clicked X
      // while the current attempt was in flight.
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
        const delay = TRANSCRIBE_RETRY_DELAYS_MS[attempt];
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

      // If user cancelled mid-flight, don't overwrite `skipped` with `failed`
      // or resurrect a deleted row. Just log and return.
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
    }
  },
});
