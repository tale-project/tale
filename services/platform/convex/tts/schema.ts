import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { audioFormatLiterals } from '../../lib/shared/schemas/providers';

/**
 * Per-chunk TTS audio for streaming voice-mode output. One row per
 * `(messageId, index)` sentence/paragraph slice. Rows are written in
 * `'pending'` status by the synthesize action and flipped to `'ready'`
 * (with `storageId` filled in) or `'failed'` (with `error`) once the
 * provider call finishes.
 *
 * Client subscribes to `getMessageChunks(messageId)` and plays each ready
 * chunk in `index` order via a chained `<audio>` element. Failed chunks
 * are skipped — there is no `speechSynthesis` browser fallback path;
 * playback is provider-only.
 *
 * Rows are eligible for opportunistic GC after ~7 days. Cleanup is
 * scheduled from `markChunkReadyAndRecordUsage` (the write path) — queries
 * cannot use `ctx.scheduler` so the read path never triggers GC. Idle
 * threads (no new chunks) are swept by the daily TTS org-sweep cron in
 * `crons.ts`.
 *
 * Identity contract: every `'pending'` row carries an `attemptCreatedAt`
 * timestamp returned by `reserveChunk`; `markChunkReadyAndRecordUsage` and
 * `markChunkFailed` refuse writes whose `attemptCreatedAt` no longer
 * matches the row. This prevents a stale attempt's audio from being
 * stitched onto a different attempt's text after a `PENDING_STALE_MS`
 * overwrite — see `tts/mutations.ts` for the full state machine.
 */
export const ttsAudioChunksTable = defineTable({
  messageId: v.string(),
  threadId: v.string(),
  organizationId: v.string(),
  // Per GDPR Art 17 (right to erasure), every chunk records the user who
  // triggered its synthesis so `cascadeOnMemberRemoved` can sweep the rows
  // without walking every thread the user ever touched. Optional so rows
  // written before this field existed still validate; the daily org-sweep
  // cron eventually reaps those legacy rows once `CHUNK_RETENTION_MS`
  // elapses.
  userId: v.optional(v.string()),
  // Team attribution captured at reserve time so the ledger row carries
  // team budget context. Mirrors the optional `teamId` on `usageLedger`.
  teamId: v.optional(v.string()),
  index: v.number(),
  text: v.string(),
  storageId: v.optional(v.id('_storage')),
  // Pre-resolved storage URL. Set when the row flips to `'ready'` so the
  // subscriber query (`getMessageChunks`) doesn't have to call
  // `ctx.storage.getUrl` on every tick — a long message of N chunks would
  // otherwise pay O(N) storage round-trips per subscription tick.
  audioUrl: v.optional(v.string()),
  status: v.union(
    v.literal('pending'),
    v.literal('ready'),
    v.literal('failed'),
  ),
  // Stable `TtsErrorCode` literal — see `synthesize.ts`. Free-form detail
  // is never written here because this field is fan-out to every org
  // member via `getMessageChunks` subscriptions.
  error: v.optional(v.string()),
  // Identity token returned by `reserveChunk` and verified on every
  // subsequent mark-* mutation. Renewed on each stale-pending overwrite
  // so a slow action holding the prior token can't land its write on the
  // refreshed row. Optional because legacy rows pre-date this field.
  attemptCreatedAt: v.optional(v.number()),
  // Wall-clock timestamp of the successful ledger write. Lets a retry
  // detect partial-completion (storage stored but ledger never written)
  // and avoid double-billing.
  usageRecordedAt: v.optional(v.number()),
  locale: v.string(),
  voice: v.optional(v.string()),
  providerName: v.optional(v.string()),
  modelId: v.optional(v.string()),
  // Audio container format — pinned to the shared literal list so schema
  // and resolver can never drift. Optional because legacy rows (pre-narrow)
  // already validated under `v.string()` and have known-good values.
  format: v.optional(
    v.union(...audioFormatLiterals.map((literal) => v.literal(literal))),
  ),
  createdAt: v.number(),
})
  .index('by_message', ['messageId', 'index'])
  .index('by_thread_age', ['threadId', 'createdAt'])
  // Org-scoped paging for cascade-delete on org removal and GDPR erasure.
  .index('by_org_createdAt', ['organizationId', 'createdAt'])
  // Per-user GDPR erasure path. `cascadeOnMemberRemoved` queries by
  // `(userId, organizationId)` to find every chunk a removed member ever
  // synthesised in this org. Older rows lacking `userId` are reaped by
  // the daily org-sweep cron instead.
  .index('by_user_org', ['userId', 'organizationId']);
