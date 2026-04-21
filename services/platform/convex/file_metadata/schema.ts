import { defineTable } from 'convex/server';
import { v } from 'convex/values';

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
})
  .index('by_organizationId', ['organizationId'])
  .index('by_storageId', ['storageId'])
  .index('by_organizationId_and_documentId', ['organizationId', 'documentId'])
  .index('by_organizationId_and_source_and_documentId', [
    'organizationId',
    'source',
    'documentId',
  ])
  .index('by_org_user', ['organizationId', 'uploadedBy'])
  .index('by_org_contentHash', ['organizationId', 'contentHash']);
