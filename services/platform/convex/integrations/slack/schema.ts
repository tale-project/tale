import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Maps a Slack conversation (org + channel + root thread ts) to a stable Tale
 * agent thread, so every reply within one Slack thread continues the same agent
 * conversation. Mirrors `agentWebhookUserThreads`: lazily inserted by
 * `getOrCreateSlackThread`, race-free under Convex OCC.
 *
 * `slackUserId` is the initiating author; the thread owner on `threadMetadata`
 * is the org-scoped external identity `slack:<organizationId>:<slackUserId>`
 * (see `identities/external_identities_schema.ts`). `slackUserName` is
 * denormalized here for convenience / display.
 *
 * `by_threadId` backs both the cascade cleanup (`cascadeDeleteThreadChildren`)
 * and the dangling-mapping guard in `getOrCreateSlackThread`; `by_organizationId`
 * backs org-teardown cleanup.
 */
export const slackThreadsTable = defineTable({
  organizationId: v.string(),
  channel: v.string(),
  // threadTs of the root message, or the triggering message ts for a top-level
  // mention. Stable key for "this Slack thread".
  conversationTs: v.string(),
  threadId: v.string(),
  slackUserId: v.string(),
  slackUserName: v.optional(v.string()),
  createdAt: v.number(),
})
  .index('by_conversation', ['organizationId', 'channel', 'conversationTs'])
  .index('by_threadId', ['threadId'])
  .index('by_organizationId', ['organizationId']);

/**
 * Idempotency ledger for inbound Slack events. One row per Slack `event_id`.
 * Slack retries deliveries (X-Slack-Retry-Num), so the async processor claims
 * an event here before doing any work — a duplicate/retry finds the row and is
 * dropped. Rows expire after a short TTL and are reaped opportunistically
 * (rate-limiter-gated, self-draining) inside `claimSlackEvent`; there is no
 * cron. Use the built-in `_creationTime` for insertion time.
 */
export const slackEventDedupTable = defineTable({
  eventId: v.string(),
  expiresAt: v.number(),
})
  .index('by_eventId', ['eventId'])
  .index('by_expiresAt', ['expiresAt']);
