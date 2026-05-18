import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';

/**
 * Video-link ingestion jobs. One row per pasted video URL.
 *
 * Kept SEPARATE from `fileMetadata` because the row's identity is the URL +
 * pipeline state — there is no `_storage` blob at insert time, and several
 * existing erasure / retention paths in `fileMetadata` assume `storageId` is
 * non-null. The terminal `fileMetadataId` ties this job to the row that
 * eventually owns the transcript blob.
 *
 * Lifecycle (single owner = `ingest_video_link.ts` action):
 *   queued
 *     → fetching_metadata     (yt-dlp -j)
 *     → fetching_captions     (captions branch)
 *         → indexing → completed
 *     OR
 *     → extracting_audio      (whisper-fallback branch)
 *     → transcribing_handoff  (schedules transcribeAudio; chip displayStatus
 *                              now derives from fileMetadata.transcriptionStatus
 *                              via the reactive client-side join in
 *                              api.video_links.queries.listForThread)
 *     → completed | failed | skipped
 *
 * Cancel: cancelVideoLink flips status='skipped' and, if Whisper-in-flight,
 * also patches the linked fileMetadata.transcriptionStatus='skipped' so the
 * existing transcribe_audio.ts:317-337 early-exit fires.
 */
export const videoLinkJobsTable = defineTable({
  organizationId: v.string(),
  /**
   * Optional. Welcome-page pastes (before the first user message creates a
   * thread) carry `threadId: undefined`; the `bindCompletedJobsToMessage`
   * mutation patches it in on the first send. Mirrors the audio-upload
   * pattern in `fileMetadata.threadId`.
   */
  threadId: v.optional(v.string()),
  uploadedBy: v.string(),

  // Source URL + provenance
  sourceUrl: v.string(),
  // sha256(normalizedUrl).slice(0,16). Used for (a) in-thread dedup index,
  // (b) log redaction (we log the hash + host + path-prefix, never the raw
  // URL with its tracking/auth params).
  sourceUrlHash: v.string(),
  // Coarse platform classification for telemetry/chip-icon only. NEVER gates
  // processing — yt-dlp accepts any host.
  sourcePlatform: v.string(), // 'youtube' | 'bilibili' | 'vimeo' | 'generic' | ...

  // The exact substring captured at paste time. Used by use-send-message.ts
  // for literal String.replace stripping (regex over arbitrary URL shapes
  // is fragile). Same value persists across retries.
  pastedToken: v.string(),

  // Metadata fetched from yt-dlp -j during Phase A
  videoTitle: v.optional(v.string()),
  videoUploader: v.optional(v.string()),
  videoDurationSec: v.optional(v.number()),
  // Language declared by yt-dlp metadata or inferred from the first manual
  // subtitle track. Drives fidelity-first caption selection.
  videoLanguage: v.optional(v.string()),
  // YouTube chapter index when present — prepended to the persisted
  // transcript as a TOC so the agent can cite "Chapter 3: …".
  videoChapters: v.optional(
    v.array(
      v.object({
        startSec: v.number(),
        endSec: v.number(),
        title: v.string(),
      }),
    ),
  ),

  // Captions selection outcome (set when Phase B succeeds; null when forced
  // to Whisper). Drives the chip's "captions from <lang>" vs "transcribed
  // from audio" affordance.
  transcriptSource: v.optional(
    v.union(
      v.literal('captions_human'),
      v.literal('captions_auto'),
      v.literal('whisper'),
    ),
  ),
  captionTrackKind: v.optional(
    v.union(
      v.literal('manual'),
      v.literal('asr'),
      v.literal('auto-translated'),
    ),
  ),
  captionLang: v.optional(v.string()),

  // Lifecycle
  status: v.union(
    v.literal('queued'),
    v.literal('fetching_metadata'),
    v.literal('fetching_captions'),
    v.literal('extracting_audio'),
    v.literal('transcribing_handoff'),
    v.literal('indexing'),
    v.literal('completed'),
    v.literal('failed'),
    v.literal('skipped'),
  ),
  // Mandatory: every `status` patch must update this. Watchdog reads
  // (now - statusChangedAt) vs per-status windows; using `_creationTime`
  // would incorrectly flag stuck rows that just retried.
  statusChangedAt: v.number(),
  // Human-readable hint for the chip (e.g. "transcribing chunk 2 of 4").
  // For Whisper-branch, populated via heartbeat from transcribe_audio.ts.
  progress: v.optional(v.string()),
  attempts: v.optional(v.number()), // 0..3
  errorReasonCode: v.optional(v.string()), // mapped from ytdlp.ts stderr classifier
  errorMessage: v.optional(v.string()), // sanitized — no raw URL or tokens

  // Linked artifacts (populated as the pipeline advances)
  // - captions branch: storageId = transcript blob, fileMetadataId = synthetic row
  // - whisper branch:  storageId = audio blob,      fileMetadataId = audio row
  storageId: v.optional(v.id('_storage')),
  fileMetadataId: v.optional(v.id('fileMetadata')),

  // Reserved for soft-delete / trash retention parity with other tables.
  // Bind-to-message tracking lives on `messageBoundAt` below, NOT here —
  // `'bound'` is not a valid lifecycleStatus literal and conflating the
  // two creates a dead dedup guard (see R2 review).
  lifecycleStatus: v.optional(lifecycleStatusValidator),
  // Timestamp at which `bindCompletedJobsToMessage` attached this job's
  // transcript to a sent chat message. `undefined` = still in the draft
  // chip area; defined = already referenced by a message bubble.
  // Used by bind dedup (so a double-tap send doesn't attach twice) and
  // by `useChatVideoLinks` to hide bound chips from the composer.
  messageBoundAt: v.optional(v.number()),
})
  .index('by_threadId', ['threadId'])
  // Concurrency cap enforcement: count in-flight rows per org cheaply.
  .index('by_organizationId_and_status', ['organizationId', 'status'])
  // Watchdog: per-status sweep for stuck rows (used by
  // recoverStuckVideoLinkJobs called from the existing
  // recoverStuckTranscriptions cron).
  .index('by_status', ['status'])
  // In-thread URL dedup: same URL pasted twice returns the existing jobId.
  .index('by_organizationId_and_sourceUrlHash', [
    'organizationId',
    'sourceUrlHash',
  ])
  // Subject-erasure cascade (GDPR right-to-be-forgotten).
  .index('by_org_user', ['organizationId', 'uploadedBy']);
