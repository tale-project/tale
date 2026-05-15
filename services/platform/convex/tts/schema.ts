import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Per-chunk TTS audio for streaming voice-mode output. One row per
 * `(messageId, index)` sentence/paragraph slice. Rows are written in
 * `'pending'` status by the synthesize action and flipped to `'ready'`
 * (with `storageId` filled in) or `'failed'` (with `error`) once the
 * provider call finishes.
 *
 * Client subscribes to `getMessageChunks(messageId)` and plays each ready
 * chunk in `index` order via a chained `<audio>` element. Failed chunks
 * trigger the browser `speechSynthesis` fallback path on the client.
 *
 * Rows are eligible for opportunistic GC after ~7 days. Cleanup is triggered
 * from `getMessageChunks` (the read path) and gated by the `cleanup:tts`
 * rate-limiter token so it runs at most once per thread per hour regardless
 * of subscription chatter.
 */
export const ttsAudioChunksTable = defineTable({
  messageId: v.string(),
  threadId: v.string(),
  organizationId: v.string(),
  index: v.number(),
  text: v.string(),
  storageId: v.optional(v.id('_storage')),
  status: v.union(
    v.literal('pending'),
    v.literal('ready'),
    v.literal('failed'),
  ),
  error: v.optional(v.string()),
  locale: v.string(),
  voice: v.optional(v.string()),
  providerName: v.optional(v.string()),
  modelId: v.optional(v.string()),
  format: v.optional(v.string()),
  createdAt: v.number(),
})
  .index('by_message', ['messageId', 'index'])
  .index('by_thread_age', ['threadId', 'createdAt'])
  // Org-scoped paging for cascade-delete on org removal and GDPR erasure.
  .index('by_org_createdAt', ['organizationId', 'createdAt']);
