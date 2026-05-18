import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';

export const fileMetadataTable = defineTable({
  organizationId: v.string(),
  storageId: v.id('_storage'),
  documentId: v.optional(v.id('documents')),
  source: v.optional(v.union(v.literal('user'), v.literal('agent'))),
  fileName: v.string(),
  contentType: v.string(),
  size: v.number(),
  pageCount: v.optional(v.number()),
  scannedPagesDetected: v.optional(v.number()),
  visionRequired: v.optional(v.boolean()),
  ocrApplied: v.optional(v.boolean()),
  ragStatus: v.optional(
    v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
    ),
  ),
  ragError: v.optional(v.string()),
  ragProgress: v.optional(v.string()),
  // Timestamp (ms) when ragStatus was last set to 'queued'. Used by the
  // poll-timeout watchdog to give up on uploads that never reached RAG
  // (e.g. scheduled action silently failed before hitting the service).
  // Falls back to _creationTime when absent on older rows.
  ragQueuedAt: v.optional(v.number()),
  // Audio transcription (populated when contentType starts with 'audio/').
  transcript: v.optional(v.string()),
  transcriptionStatus: v.optional(
    v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('skipped'),
    ),
  ),
  transcriptionError: v.optional(v.string()),
  transcriptionDurationSec: v.optional(v.number()),
  // Human-readable progress hint while transcriptionStatus is 'running'
  // (e.g. "compressing", "transcribing chunk 2 of 4"). Cleared on completion.
  transcriptionProgress: v.optional(v.string()),
  // RAG indexing of the transcript (separate from ragStatus above, which is
  // gated out at scheduling time for audio uploads — see mutations).
  transcriptRagStatus: v.optional(
    v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
    ),
  ),
  transcriptRagError: v.optional(v.string()),
  // SHA-256 of the raw uploaded audio bytes. Used for dedup across uploads
  // of the same content (different storageIds, same hash) — transcribeAudio
  // short-circuits to the cached transcript when a prior row in the same
  // org has completed transcription of the same content.
  contentHash: v.optional(v.string()),
  uploadedBy: v.optional(v.string()),
  /**
   * For chat-uploaded files, the chat thread the file was attached to.
   *
   * Three classes of `fileMetadata` after this field landed:
   *  - Document Hub: `documentId` set, `threadId` unset → org-wide knowledge
   *  - Chat upload: `documentId` unset, `threadId` set → bound to thread chain
   *  - Legacy / integration: both unset → falls back to same-org check
   *
   * Drives:
   *  - `rag_search` access: chat-bound files require caller's `ctx.threadId`
   *    to be in the same chain (verified by
   *    `verifyStorageIdsInThreadScope` + a chain walk in action context)
   *  - Soft-delete cascade: trashing a thread also trashes its bound files
   *    (lifecycleStatus='trashed' + statusChangedAt sync); restoring the
   *    thread restores the same set; hard-delete cascades to `_storage`
   *    blob + RAG purge via `eraseDocumentBlobs` style helper
   */
  threadId: v.optional(v.string()),
  lifecycleStatus: v.optional(lifecycleStatusValidator),
  statusChangedAt: v.optional(v.number()),
  /**
   * Video-link provenance. Populated when this fileMetadata row's transcript
   * originated from the yt-dlp pipeline (captions branch creates a synthetic
   * row with the transcript blob; whisper branch reuses the audio-upload
   * row). Decoupled from `videoLinkJobs` so RAG citations and
   * `document_retrieve` keep working after the job row is GC'd.
   *
   * Backward-compat: ALL optional. Existing rows and direct-upload rows
   * leave these unset.
   *
   * NO `videoThumbnailUrl` here: `services/platform/server.ts` CSP
   * (img-src 'self' data: blob:) hard-blocks remote <img>. Add via the
   * existing `/api/image-proxy` pattern when chip thumbnail is promoted.
   */
  sourceUrl: v.optional(v.string()),
  sourcePlatform: v.optional(v.string()),
  videoTitle: v.optional(v.string()),
  videoUploader: v.optional(v.string()),
  videoDurationSec: v.optional(v.number()),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_lifecycleStatus', [
    'organizationId',
    'lifecycleStatus',
  ])
  .index('by_storageId', ['storageId'])
  .index('by_organizationId_and_documentId', ['organizationId', 'documentId'])
  .index('by_organizationId_and_source_and_documentId', [
    'organizationId',
    'source',
    'documentId',
  ])
  .index('by_org_user', ['organizationId', 'uploadedBy'])
  .index('by_org_contentHash', ['organizationId', 'contentHash'])
  // Chat-upload cascade: trash/restore/erase a thread → enumerate the
  // thread's bound files in O(1) per thread. Same shape as the soft-delete
  // composite index for status-narrowed sweeps.
  .index('by_organizationId_and_threadId', ['organizationId', 'threadId'])
  // Watchdog sweep: the `recoverStuckTranscriptions` cron runs every 5
  // minutes and only cares about rows whose `transcriptionStatus` is
  // `'running'`. The vast majority of rows are `'completed'` /
  // `'skipped'` / unset and an unindexed scan was paying for those on
  // every tick (round-2 M2). Indexing on the status field plus
  // `_creationTime` lets the cron iterate the tiny live set directly.
  .index('by_transcriptionStatus', ['transcriptionStatus']);
