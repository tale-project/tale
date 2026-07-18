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
  // Last tier the controller settled on (effort-tier anti-oscillation guard).
  // Optional; absence disables the guard for that bucket.
  lastTier: v.optional(
    v.union(
      v.literal('off'),
      v.literal('low'),
      v.literal('medium'),
      v.literal('high'),
    ),
  ),
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
   * Park-on-capacity: set (with `generationStatus` kept 'generating') while a
   * turn is WAITING for a free sandbox slot — the org is at its concurrency cap.
   * The composer reads this to show "Queued for capacity" instead of "Thinking".
   * Cleared when the turn is admitted and actually starts (or on turn end). The
   * generation lock + liveness stay 'generating' so the thread still blocks new
   * turns and the re-park heartbeat keeps it fresh.
   */
  generationQueuedSince: v.optional(v.number()),
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
  /**
   * External-agent (Claude Code) turn posture for this thread. `plan` runs
   * each turn read-only (`--permission-mode plan`): the agent explores and
   * proposes a plan that surfaces as an approval card; `act` (or missing —
   * the default) is the existing full-access behavior. Sticky per thread;
   * flipped by the composer toggle, by plan-card approval (→ `act`), and by
   * plan detection at turn end (→ `plan`, so an agent-initiated plan leaves
   * the toggle reflecting reality).
   */
  externalAgentMode: v.optional(v.union(v.literal('plan'), v.literal('act'))),
  /**
   * External-agent working directory for this thread, RELATIVE to the sandbox
   * workspace root (`/user/workspace`); unset = the root itself. Every turn's
   * CLI process starts here (and the repo-skill precedence scan follows), so a
   * repo checked out in a subdir exposes its own CLAUDE.md / project skills.
   * Set by the composer workdir chip; validated by lib/shared/sandbox-workdir
   * — the platform is the only workspace-confinement guard (runnerd allows any
   * existing dir under /user). A missing dir falls back to the root at turn
   * time (fail-open; the chip probes existence at save time).
   */
  sandboxWorkdir: v.optional(v.string()),
  /**
   * Discussions reuse this thread/message store. `kind` distinguishes a normal
   * chat (absent or 'chat') from a GitHub-Discussions-style project discussion,
   * a task discussion, or an app-embedded discussion (the AgentChat block's
   * shared thread). Discussion kinds are accessible to org members (see
   * `can_access_thread`), not just the owner. The fields below are all
   * optional + additive — a `chat` thread behaves exactly as before.
   */
  kind: v.optional(
    v.union(
      v.literal('chat'),
      v.literal('project_discussion'),
      v.literal('task_discussion'),
      v.literal('automation_discussion'),
    ),
  ),
  /** Task a `task_discussion` is attached to. */
  taskId: v.optional(v.id('tasks')),
  /**
   * Automation-embedded discussion scoping (`kind: 'automation_discussion'`): the ONE shared
   * thread per (organizationId, automationSlug, subjectType, subjectId) that an
   * installed automation's AgentChat block resolves via `by_org_automation_subject` (see
   * `threads/get_or_create_automation_thread.ts`). Access is org-membership-gated
   * like the other discussion kinds — an automation thread may carry no `projectId`.
   * `subjectType`/`subjectId` are host-defined (e.g. ('task', <taskId>)); an
   * install-scoped chat uses ('automation', <automationSlug>).
   */
  automationSlug: v.optional(v.string()),
  subjectType: v.optional(v.string()),
  subjectId: v.optional(v.string()),
  /** Discussion lifecycle (orthogonal to the retention `status` field). */
  discussionStatus: v.optional(
    v.union(v.literal('open'), v.literal('resolved'), v.literal('locked')),
  ),
  /** Category slug (general/qa/ideas/decisions/announcements). */
  discussionCategory: v.optional(v.string()),
  /** For a Q&A discussion, the message marked as the accepted answer. */
  acceptedAnswerMessageId: v.optional(v.string()),
  /** A task spawned from this discussion (bidirectional with tasks.sourceDiscussionThreadId). */
  linkedTaskId: v.optional(v.id('tasks')),
  /**
   * Agent→agent reply-chain depth for the discussion loop guard. Incremented
   * when an agent reply is triggered by another agent; reset to 0 by any human
   * reply. The discussion reply path refuses to dispatch once this exceeds the
   * `MAX_AGENT_REPLY_CHAIN_DEPTH` constant (lib/shared/constants/discussions),
   * bounding runaway agent chatter.
   */
  agentReplyDepth: v.optional(v.number()),
  /**
   * Tool-gating unlocks (#2781): capability-group ids the model unlocked via
   * `request_capabilities` on this thread. Sticky-grow only — groups are
   * added, never removed — so the provider prompt-cache prefix stays stable
   * across the thread's turns (a tool-set change invalidates it, so it must
   * remain a rare, monotonic event). Group ids are defined in
   * `agent_tools/tool_gating.ts`; unknown ids are ignored on read.
   */
  unlockedToolGroups: v.optional(v.array(v.string())),
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
  .index('by_projectId_and_userId', ['projectId', 'userId'])
  // Discussions: list a project's discussions, and a task's discussion(s).
  .index('by_kind_projectId', ['kind', 'projectId'])
  .index('by_kind_taskId', ['kind', 'taskId'])
  // Automation-embedded chat (AgentChat block): resolve the one shared
  // `automation_discussion` thread for a (org, automation, subject) triplet without
  // scanning the org's threads (threads/get_or_create_automation_thread.ts).
  .index('by_org_automation_subject', [
    'organizationId',
    'automationSlug',
    'subjectType',
    'subjectId',
  ])
  // Deploy drain + recovery watchdog: enumerate the (small) set of threads
  // currently `generating` without scanning every thread. Used by
  // `control/drain.ts:countActiveGenerations` and
  // `agents/recover_stuck_chat_turns.ts`.
  .index('by_generationStatus', ['generationStatus']);

/**
 * Messages sent while a turn is running (Claude-Code-TUI-style "keep typing
 * while it works"). Persist-at-pick: the queue row is the ONLY record until
 * the message is actually picked (steer-injected mid-turn or boundary-
 * drained) — the composer's queue tray renders waiting rows, and the
 * transcript copy is created at the pick so its position is final on first
 * render (an enqueue-time copy sorted mid-turn and reshuffled the list as
 * later rows streamed in). Delivery state:
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
  /** Thread's selected model id at enqueue. The boundary-drain turn re-enters
   * runChatTurnGeneration, which otherwise resolves modelId=undefined → the
   * org default — silently swapping the user's pick (and 403'ing outright
   * when the session VK is single-model). Optional: legacy rows + Auto. */
  modelId: v.optional(v.string()),
  /** Stable identity token in the steer-file contract (file names + consumed.*
   * markers). For rows with `deferredPersist` this is the queue row's own id —
   * no message exists until the pick; for legacy rows (saved at enqueue) it is
   * the agent-component message _id. */
  messageId: v.string(),
  /** Agent-component message _id of the transcript copy, created at the PICK
   * (steer injection / boundary drain / terminal reconcile) — persist-at-pick
   * keeps the copy's `_creationTime` at injection time so its transcript
   * position is final on first render. Unset while the row is waiting. */
  savedMessageId: v.optional(v.string()),
  /** Marks rows under the persist-at-pick model (no message saved at enqueue).
   * Legacy rows in flight across the deploy that introduced this keep their
   * enqueue-time message and must not be double-saved at the pick. */
  deferredPersist: v.optional(v.boolean()),
  /** Exact content; drain prompt + steer payload source. */
  text: v.string(),
  status: v.union(
    v.literal('queued'),
    v.literal('claimed'),
    v.literal('delivered'),
    v.literal('consumed'),
  ),
  claimedByStreamId: v.optional(v.string()),
  deliveredExecId: v.optional(v.string()),
  /** Which channel carried a 'delivered' row: 'file' = staged steer-*.json the
   * in-image hook consumes at a tool/stop boundary (consumed.* marker is the
   * evidence); 'stdin' = pushed into the held-open stream-json stdin while the
   * exec lingered idle (the next agent result is the evidence — there is no
   * marker, so terminal reconciliation must NOT trust markers for these).
   * Cleared whenever the row rolls back to 'queued'. */
  deliveredChannel: v.optional(v.union(v.literal('file'), v.literal('stdin'))),
  createdAt: v.number(),
  claimedAt: v.optional(v.number()),
  deliveredAt: v.optional(v.number()),
})
  .index('by_threadId_status', ['threadId', 'status'])
  .index('by_organizationId', ['organizationId']);
