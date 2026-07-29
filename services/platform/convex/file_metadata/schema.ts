import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';
import { blobRefValidator } from '../lib/storage/blob_ref';

export const fileMetadataTable = defineTable({
  organizationId: v.string(),
  // Blob reference: a Convex `_storage` id (default) OR an `s3:<key>` ref in the
  // org's own bucket. Widened from `v.id('_storage')` — every existing id still
  // validates, and the `by_storageId` index keys off the string form either way.
  storageId: blobRefValidator,
  documentId: v.optional(v.id('documents')),
  // Open provenance string (no hard enum, so a new channel needs no schema
  // change — mirrors documents.sourceProvider). Reserved values:
  //   'user'       — member-uploaded via the UI
  //   'agent'      — model / automation-generated
  //   'video_link' — yt-dlp transcript; TRUST-DISTINCT, wrapped in
  //                  <untrusted_source> on RAG retrieval (R2 review)
  //   <connector>  — external import: the connector slug verbatim, e.g.
  //                  'confluence', 'google_drive', 'onedrive', 'sharepoint',
  //                  'webdav', or any connector slug. Set by
  //                  linkDocumentToFile from the linked document's
  //                  sourceProvider when a blob is promoted to a document.
  // Only 'user' and 'agent' participate in the temp-retention GC lanes; import
  // slugs (and undefined) are never reclaimed by the sweep.
  source: v.optional(v.string()),
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
      // Terminal, non-retryable: the format has no text extractor (e.g. a
      // OneDrive-synced .loop file arriving as application/octet-stream).
      // Set once at saveFileMetadata time — never scheduled, never queued —
      // so the UI can distinguish "will never index" from the transient
      // undefined "not indexed yet" state and skip the retry affordance.
      v.literal('unsupported'),
    ),
  ),
  ragError: v.optional(v.string()),
  ragProgress: v.optional(v.string()),
  // Timestamp (ms) when ragStatus was last set to 'queued'. Used by the
  // poll-timeout watchdog to give up on uploads that never reached RAG
  // (e.g. scheduled action silently failed before hitting the service).
  // Falls back to _creationTime when absent on older rows.
  ragQueuedAt: v.optional(v.number()),
  // Per-org indexing concurrency cap. When the upload path enqueues a file
  // but the org is already at its in-flight limit, the row is inserted as
  // `'queued'` with `ragParked: true` and its indexing action is NOT
  // scheduled — it waits. `promoteQueuedRagJobs` clears the flag and
  // schedules the action when a slot frees (on each terminal transition).
  // A `'queued'` row WITHOUT this flag is in flight (its action is scheduled
  // or running), which is also the safe reading for legacy rows and for the
  // Hub/retry paths that don't park — so only the cap ever sets it.
  ragParked: v.optional(v.boolean()),
  // Unix SECONDS when ragStatus most recently reached 'completed'. Canonical
  // replacement for the retired documents.ragInfo.indexedAt — stamped by
  // updateFileRagStatus on completion, read by getDocumentRagProjection. Seconds
  // (not ms) to match the legacy writer, the backfill, and the RagStatusBadge's
  // `new Date(indexedAt * 1000)` render.
  ragIndexedAt: v.optional(v.number()),
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
  // Single-flight lock for the `transcribeAudio` action. Set atomically
  // by `acquireTranscriptionLock` when status transitions queued/null →
  // running. Concurrent invocations on the same storageId (e.g. a
  // `retryTranscription` double-click) check the run id under a lease
  // window and short-circuit if another invocation is in flight.
  // Cleared on completion / final failure / lease expiry.
  transcriptionRunId: v.optional(v.string()),
  // Unix ms; transcribeAudio re-acquisition is gated until this point.
  // `recoverStuckTranscriptions` (watchdog) breaks the lock once the
  // lease expires AND there's been no progress.
  transcriptionLeaseExpiresAt: v.optional(v.number()),
  // Unix ms when transcriptionStatus most recently flipped to 'running'
  // (stamped by acquireTranscriptionLock). Used by the watchdog to
  // detect stuck transcriptions without confusing a freshly-retried row
  // — `_creationTime` alone caused fresh retries of old rows to be
  // killed within seconds. Falls back to `_creationTime` for legacy
  // rows that pre-date this field.
  transcriptionStartedAt: v.optional(v.number()),
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
  // SHA-256 (hex) of the raw bytes for sandbox-harvested output files.
  // Set by `insertOutputFiles` from the spawner's harvest payload; used for
  // pre-stage attestation when the same file is later re-injected into
  // another run's `/user/output/`. Distinct from `contentHash` (audio
  // transcript dedup) — different write source, different purpose. Optional
  // because non-sandbox uploads (chat attachments, document imports) don't
  // compute it.
  sha256: v.optional(v.string()),
  uploadedBy: v.optional(v.string()),
  /**
   * For chat-uploaded files, the chat thread the file was attached to.
   *
   * Three classes of `fileMetadata` after this field landed:
   *  - Document Hub: `documentId` set, `threadId` unset → org-wide knowledge
   *  - Chat upload: `documentId` unset, `threadId` set → bound to thread chain
   *  - Legacy / connector: both unset → falls back to same-org check
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
  // Canonical "list indexed Document-Hub files in this org" lookup — replaces
  // the documents-side by_organizationId_and_indexed index after RAG status
  // collapsed onto fileMetadata. Used by getAgentScopedFileIds +
  // listIndexedDocumentsForAgent, queried as
  // `.eq(org).eq('ragStatus','completed').gt('documentId', undefined)`: the
  // documentId third field lets the range bound SEEK past chat-upload /
  // transcript rows (documentId absent → ordered as `undefined`, the least
  // value), so the scan stays dense with Hub docs instead of being inflated by
  // the org's chat corpus. (Convex orders: undefined < null < … < string.)
  .index('by_organizationId_and_ragStatus_and_documentId', [
    'organizationId',
    'ragStatus',
    'documentId',
  ])
  // Watchdog sweep: the `recoverStuckTranscriptions` cron runs every 5
  // minutes and only cares about rows whose `transcriptionStatus` is
  // `'running'`. The vast majority of rows are `'completed'` /
  // `'skipped'` / unset and an unindexed scan was paying for those on
  // every tick (round-2 M2). Indexing on the status field plus
  // `_creationTime` lets the cron iterate the tiny live set directly.
  .index('by_transcriptionStatus', ['transcriptionStatus'])
  // RAG watchdog sweep: the `recoverStuckRagIndexing` cron runs every 5
  // minutes and only cares about rows still in flight (`'queued'` /
  // `'running'`). Same rationale as `by_transcriptionStatus` — index on
  // the status field so the cron iterates only the tiny live set instead
  // of scanning the whole table (which is dominated by `'completed'` /
  // terminal rows) every tick. `_creationTime` is the implicit trailing
  // key, giving age-ordered iteration for free.
  .index('by_ragStatus', ['ragStatus']);
