import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { autoRouteReasonValidator } from '../streaming/validators';
import { chatTypeValidator, threadStatusValidator } from './validators';

/** One Adaptive Reasoning Governor difficulty-bucket — mirrors `BucketStats`. */
const reasoningBucketValidator = v.object({
  count: v.number(),
  mean: v.number(),
  m2: v.number(),
  underResourcedEma: v.number(),
  // Added after the initial schema; optional so legacy rows (written before
  // this field existed) keep validating. Readers coalesce `undefined` to 0.
  wastefulEma: v.optional(v.number()),
  // Response-quality EMA per class (quality-feedback governor). Optional;
  // legacy rows omit it and readers coalesce to a neutral 1.0.
  qualityEma: v.optional(v.number()),
});

export const threadMetadataTable = defineTable({
  threadId: v.string(),
  userId: v.string(),
  chatType: chatTypeValidator,
  status: threadStatusValidator,
  /**
   * Timestamp of the last `status` transition. Required for the retention
   * grace-window math: a `trashed`/`expired` row hard-deletes when
   * `now - statusChangedAt > graceDays`. `optional` for backward-compat
   * with rows written before this field was introduced; treat missing as
   * "no grace timer started" (cleanup falls back to `_creationTime`).
   */
  statusChangedAt: v.optional(v.number()),
  title: v.optional(v.string()),
  createdAt: v.number(),
  generationStatus: v.optional(
    v.union(v.literal('generating'), v.literal('idle')),
  ),
  streamId: v.optional(v.string()),
  cancelledAt: v.optional(v.number()),
  cancelledMessageId: v.optional(v.string()),
  generationStartTime: v.optional(v.number()),
  /**
   * Liveness heartbeat for long-running generations. External-agent turns can
   * legitimately outlive the stale threshold measured from
   * `generationStartTime` alone (always-on runs, cross-action continuation);
   * the sandbox runner bumps this every ~20s so staleness is judged against
   * the most recent sign of life, while `generationStartTime` stays fixed as
   * the turn's wall-clock anchor for the live "Thinking · Ns" timer.
   */
  generationHeartbeatAt: v.optional(v.number()),
  /**
   * Adaptive Reasoning Governor (Layer C) per-thread learning state: per
   * difficulty-class Welford statistics of observed reasoning tokens plus an
   * "under-resourced" EMA, letting the governor learn a difficulty→need curve
   * and converge the budget toward what the model actually uses. Updated once
   * per completed turn from telemetry the platform already records. Shape must
   * mirror `ReasoningState` in `lib/agent_response/reasoning/types.ts`.
   */
  reasoningState: v.optional(
    v.object({
      easy: reasoningBucketValidator,
      medium: reasoningBucketValidator,
      hard: reasoningBucketValidator,
      turns: v.number(),
      // Cross-class intensity distribution for self-calibrating difficulty
      // thresholds. Optional; legacy rows fall back to the static thresholds.
      intensityCount: v.optional(v.number()),
      intensityMean: v.optional(v.number()),
      intensityM2: v.optional(v.number()),
    }),
  ),
  /**
   * Auto-compaction rolling summary. When a thread's history approaches the
   * model's context-window budget, the oldest turns are folded into this dense
   * summary (see `lib/context_management/compaction/`) instead of being
   * silently dropped. The context builder injects `text` ahead of the recent
   * verbatim turns and excludes every message with `order <= coversThroughOrder`
   * (those are now represented by the summary). Optional + additive: legacy
   * rows have no summary and behave exactly as before.
   */
  contextSummary: v.optional(
    v.object({
      /** The dense natural-language summary of the compacted history. */
      text: v.string(),
      /** Messages with `order <= coversThroughOrder` are folded into `text`. */
      coversThroughOrder: v.number(),
      /** Estimated tokens of `text` (for budget math). */
      tokens: v.number(),
      /** How many source messages were folded in (telemetry). */
      sourceMessageCount: v.number(),
      updatedAt: v.number(),
      /** Summary schema/version, for future re-summarization migrations. */
      version: v.number(),
    }),
  ),
  agentSlug: v.optional(v.string()),
  /**
   * The most recent "Auto" routing decision on this thread (set by
   * `resolveAutoRoute`). If the user re-sends the SAME message but explicitly
   * pins a different agent, that's a sound misroute correction — folded into
   * the auto-route cache as an `override` (see `unified_chat`). Cleared after
   * a correction is recorded.
   */
  lastAutoRoute: v.optional(
    v.object({
      messageKey: v.string(),
      candidatesHash: v.string(),
      agentSlug: v.string(),
    }),
  ),
  /**
   * TRANSIENT, turn-scoped UI signal (NOT the `lastAutoRoute` re-route cache):
   * the agent the Auto router resolved for the IN-FLIGHT turn, broadcast the
   * instant routing decides so the thinking timeline can show "Routed to X"
   * mid-turn instead of waiting for completion. Written best-effort by
   * `setLiveRoute`, cleared at the start of each turn (`markGenerating`) and at
   * the end (`clearGenerationStatus`) — persisted history reads the agent from
   * the message's own `metadata.autoRouteReason` instead.
   */
  liveRoute: v.optional(
    v.object({
      agentSlug: v.string(),
      reason: autoRouteReasonValidator,
      at: v.number(),
    }),
  ),
  /**
   * Debug/feedback record of the most recent router-driven orchestration on
   * this thread (router-as-orchestrator). Written fire-and-forget by
   * `setLastOrchestration`. Per-step transcripts live in the sub-threads.
   */
  lastOrchestration: v.optional(
    v.object({
      primaryAgentSlug: v.string(),
      deadlineHit: v.boolean(),
      steps: v.array(
        v.object({
          id: v.string(),
          agentSlug: v.string(),
          status: v.union(
            v.literal('ok'),
            v.literal('error'),
            v.literal('skipped'),
          ),
        }),
      ),
      createdAt: v.number(),
    }),
  ),
  /** @deprecated Use agentSlug. Retained for backward compatibility with existing documents. */
  agentId: v.optional(v.id('agentBindings')),
  /** @deprecated Retained for backward compatibility with existing documents. */
  customAgentId: v.optional(v.id('customAgents')),
  organizationId: v.optional(v.string()),
  // Sharing fields
  shareToken: v.optional(v.string()),
  sharedAt: v.optional(v.number()),
  sharedBy: v.optional(v.string()),
  isShared: v.optional(v.boolean()),
  forkedFrom: v.optional(v.string()),
  forkedFromShare: v.optional(v.boolean()),
  forkedMessageCount: v.optional(v.number()),
  lastForkedMessageOrder: v.optional(v.number()),
  forkedAt: v.optional(v.number()),
  // Arena mode fields
  arenaGroupId: v.optional(v.string()),
  arenaModelId: v.optional(v.string()),
  updatedAt: v.optional(v.number()),
  isBranch: v.optional(v.boolean()),
  branchSelections: v.optional(v.string()),
  // Team/workspace assignment
  teamId: v.optional(v.string()),
  /**
   * Project this thread belongs to. When set, project instructions are
   * injected into the system prompt and project files are unioned into
   * the RAG file_ids at chat time. See `lib/agent_response/build_project_instructions.ts`
   * and `documents/get_agent_scoped_file_ids.ts`.
   */
  projectId: v.optional(v.id('projects')),
  /**
   * When `true`, the thread is visible to all members of the project.
   * Atomically forces `disablePersonalization: true` (see
   * `projects/mutations.ts:setThreadSharedWithProject`) so the owner's
   * memories and custom instructions don't leak into replies that
   * other project members read.
   */
  sharedWithProject: v.optional(v.boolean()),
  // Personalization opt-out at the thread level. When true, this thread
  // skips both reads (no user memory injected into system prompt) and
  // writes (the propose_memory tool is stripped from the agent). Used by
  // future "Temporary chat" UI; v1 only the schema field is in.
  disablePersonalization: v.optional(v.boolean()),
  /**
   * Per-thread override for voice-mode TTS output. `undefined` (or row
   * missing) means "inherit from `userPreferences.voiceOutput`". Set to
   * `true`/`false` from the thread voice-output toggle to override the
   * user default for this conversation only.
   */
  voiceOutputOverride: v.optional(v.boolean()),
  /**
   * When set, the thread is pinned in the chat-history sidebar and sorts
   * above unpinned threads (most-recently-pinned first). `undefined` (or
   * row missing) means not pinned. Toggled via `setThreadPinned`.
   */
  pinnedAt: v.optional(v.number()),
  /**
   * Unread tracking for the chat-history "new response" badge. `lastReplyAt`
   * is bumped whenever generation ends (clearGenerationStatus); `lastReadAt`
   * is set when the owner opens / finishes viewing the thread. The sidebar
   * badges a thread when `lastReplyAt > lastReadAt` and it isn't the open
   * thread. Both optional for backward-compat (missing == never).
   */
  lastReplyAt: v.optional(v.number()),
  lastReadAt: v.optional(v.number()),
  /**
   * Persisted canvas (workspace) pane state, scoped per-thread. The chat
   * surface reads these on mount so reopening a thread restores whether
   * the canvas was open and which artifact path was active; writes happen
   * when the user toggles the pane or switches files. Both optional for
   * backward-compat — missing means "default closed, first file active".
   *
   * `canvasOpen`           — pane visible (`true`) / hidden (`undefined` ≈ `false`).
   * `canvasActiveFilePath` — relative path of the artifact currently shown;
   *                          `undefined` means "use the first listed file".
   */
  canvasOpen: v.optional(v.boolean()),
  canvasActiveFilePath: v.optional(v.string()),
})
  .index('by_threadId', ['threadId'])
  .index('by_userId_chatType_status', [
    'userId',
    'chatType',
    'status',
    'createdAt',
  ])
  .index('by_userId_chatType_status_updated', [
    'userId',
    'chatType',
    'status',
    'updatedAt',
  ])
  .index('by_shareToken', ['shareToken'])
  .index('by_arenaGroupId', ['arenaGroupId'])
  .index('by_organizationId', ['organizationId'])
  // Round-2 fix: GDPR `requestErasure` enumerates a single user's
  // threads within an org. Without this compound, the only path was
  // `by_organizationId.collect()` then JS-filter by `userId` — silent
  // truncation past the 16K per-transaction read limit on large orgs.
  // Used by `governance/erasure.ts:eraseUserThreadsBatch` (paged) and
  // any future cross-tenant scope checks that key on (org, user).
  .index('by_org_user', ['organizationId', 'userId'])
  // Round-2 V9 / round-1 #18 P2 + #27 P1-M: admin Trash UI's
  // `fetchTrashSubpage` needs to slice threadMetadata by status without
  // scanning every active row first. The other 12 trashable tables
  // already carry `by_organizationId_and_lifecycleStatus`; threadMetadata
  // (which uses the legacy `status` field instead of `lifecycleStatus`)
  // was the missing one — without this, an org with > ~250 active
  // threads would never surface trashed/expired threads in the admin
  // Trash list because the take-prefix filled with `active` rows first.
  .index('by_organizationId_and_status', ['organizationId', 'status'])
  // Projects feature: list all threads in a project (both personal and shared
  // members; client partitions). Index also serves `assertOrphanCheck` style
  // queries that want "any thread in this project?".
  .index('by_organizationId_and_projectId', ['organizationId', 'projectId'])
  // Projects feature: "my chats in this project" — used by the Threads tab's
  // "Your chats" segment without scanning all threads in the project first.
  .index('by_projectId_and_userId', ['projectId', 'userId']);

/**
 * Messages sent while a turn is running (Claude-Code-TUI-style "keep typing
 * while it works"). Each row pairs a timeline user message (already saved at
 * enqueue, so it renders immediately) with delivery state:
 *
 *   queued    — waiting; drained into one combined turn at the next terminal
 *               turn boundary (`settleQueueOnTurnEnd`).
 *   claimed   — picked up by a drain batch; `claimedByStreamId` is the drain
 *               turn's stream. Rows are deleted when that turn ends.
 *   delivered — staged into the RUNNING exec's steer dir (external-agent
 *               mid-turn steering); `deliveredExecId` keys the terminal
 *               reconciliation that flips it to consumed or back to queued.
 *   consumed  — the in-sandbox hook injected it into the running turn; the
 *               content is in the agent transcript. Deleted at turn end.
 *
 * Identity/audit fields are denormalized because the drain runs from internal
 * mutations with no auth context.
 */
export const chatMessageQueueTable = defineTable({
  organizationId: v.string(),
  threadId: v.string(),
  userId: v.string(),
  userEmail: v.string(),
  userName: v.string(),
  /** Thread's agent slug at enqueue — the drain turn re-enters the normal
   * generation pipeline under this slug. */
  agentSlug: v.string(),
  /** Agent-component message _id of the timeline row saved at enqueue. */
  messageId: v.string(),
  /** Exact persisted content; drain prompt source. */
  text: v.string(),
  status: v.union(
    v.literal('queued'),
    v.literal('claimed'),
    v.literal('delivered'),
    v.literal('consumed'),
  ),
  claimedByStreamId: v.optional(v.string()),
  deliveredExecId: v.optional(v.string()),
  createdAt: v.number(),
  claimedAt: v.optional(v.number()),
  deliveredAt: v.optional(v.number()),
})
  .index('by_threadId_status', ['threadId', 'status'])
  .index('by_organizationId', ['organizationId']);
