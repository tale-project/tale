/**
 * The thread container. `threadMetadata` predates the chat rewrite (the new
 * chat world lives in `threads`/`messages`, see `chat/schema.ts`) but it is
 * NOT legacy: task-comment and automation threads actively create and work
 * these rows (`tasks/internal_mutations.ts`), with the actual comment bodies
 * stored as agent-component messages and cascaded by `thread_cascade.ts`.
 *
 * The validator still admits the retired chat-era fields (arena, sharing,
 * canvas, reasoning state…) — they are dead weight on 0.4 fresh deploys and
 * can be slimmed once the discussions surface stops round-tripping whole
 * docs; slimming is a plain schema tighten now that no pre-0.4 rows exist.
 */

import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const chatTypeValidator = v.union(
  v.literal('general'),
  v.literal('workflow_assistant'),
  v.literal('agent_test'),
);

/**
 * Thread lifecycle: active / archived (user, restorable) / trashed (user,
 * restorable) / expired (retention, admin-restorable) / deleted (deprecated
 * tombstone, treated as trashed).
 */
export const threadStatusValidator = v.union(
  v.literal('active'),
  v.literal('archived'),
  v.literal('trashed'),
  v.literal('expired'),
  v.literal('deleted'),
);

/** One Adaptive Reasoning Governor difficulty-bucket. */
const reasoningBucketValidator = v.object({
  count: v.number(),
  mean: v.number(),
  m2: v.number(),
  underResourcedEma: v.number(),
  wastefulEma: v.optional(v.number()),
  qualityEma: v.optional(v.number()),
  lastTier: v.optional(
    v.union(
      v.literal('off'),
      v.literal('low'),
      v.literal('medium'),
      v.literal('high'),
    ),
  ),
});

export const autoRouteReasonValidator = v.union(
  v.literal('single-candidate'),
  v.literal('trivial'),
  v.literal('cached'),
  v.literal('classified'),
  v.literal('fallback'),
);

export const threadMetadataTable = defineTable({
  threadId: v.string(),
  userId: v.string(),
  chatType: chatTypeValidator,
  status: threadStatusValidator,
  /** Last `status` transition; optional for rows predating this field. */
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
  /** Liveness heartbeat for long-running generations. */
  generationHeartbeatAt: v.optional(v.number()),
  /** Set while a turn is parked waiting for a free sandbox slot. */
  generationQueuedSince: v.optional(v.number()),
  /** Adaptive Reasoning Governor per-thread learning state. */
  reasoningState: v.optional(
    v.object({
      easy: reasoningBucketValidator,
      medium: reasoningBucketValidator,
      hard: reasoningBucketValidator,
      turns: v.number(),
      intensityCount: v.optional(v.number()),
      intensityMean: v.optional(v.number()),
      intensityM2: v.optional(v.number()),
    }),
  ),
  /** Auto-compaction rolling summary of folded-in older turns. */
  contextSummary: v.optional(
    v.object({
      text: v.string(),
      coversThroughOrder: v.number(),
      tokens: v.number(),
      sourceMessageCount: v.number(),
      updatedAt: v.number(),
      version: v.number(),
    }),
  ),
  agentSlug: v.optional(v.string()),
  /** Most recent "Auto" routing decision on this thread. */
  lastAutoRoute: v.optional(
    v.object({
      messageKey: v.string(),
      candidatesHash: v.string(),
      agentSlug: v.string(),
    }),
  ),
  /** Transient, turn-scoped live-routing UI signal (not the re-route cache). */
  liveRoute: v.optional(
    v.object({
      agentSlug: v.string(),
      reason: autoRouteReasonValidator,
      at: v.number(),
    }),
  ),
  /** Debug/feedback record of the most recent router-as-orchestrator run. */
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
  /** Project this thread belongs to (injects project instructions + files). */
  projectId: v.optional(v.id('projects')),
  /** Visible to all project members; forces disablePersonalization true. */
  sharedWithProject: v.optional(v.boolean()),
  /** Personalization opt-out at the thread level (skips memory read+write). */
  disablePersonalization: v.optional(v.boolean()),
  /** Per-thread TTS override; undefined = inherit userPreferences.voiceOutput. */
  voiceOutputOverride: v.optional(v.boolean()),
  /** Set = thread pinned in the chat-history sidebar. */
  pinnedAt: v.optional(v.number()),
  /** Unread tracking for the chat-history "new response" badge. */
  lastReplyAt: v.optional(v.number()),
  lastReadAt: v.optional(v.number()),
  /** Persisted canvas (workspace) pane state, scoped per-thread. */
  canvasOpen: v.optional(v.boolean()),
  canvasActiveFilePath: v.optional(v.string()),
  /** External-agent (Claude Code) turn posture: 'plan' = read-only turns. */
  externalAgentMode: v.optional(v.union(v.literal('plan'), v.literal('act'))),
  /** External-agent working directory, relative to the sandbox workspace root. */
  sandboxWorkdir: v.optional(v.string()),
  /**
   * Task comments and automation threads reuse this store; `kind`
   * distinguishes them. `'project_discussion'` is RETIRED (the Discussions
   * surface is gone): nothing writes it anymore, and the
   * `0.4.1/01_purge_project_discussions` migration deletes the rows — the
   * literal stays admitted only so pre-purge rows validate until the purge
   * has run. Drop it (with the three retired fields below) in the release
   * AFTER the purge ships.
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
  /** Automation-embedded discussion scoping (org + automation + subject). */
  automationSlug: v.optional(v.string()),
  subjectType: v.optional(v.string()),
  subjectId: v.optional(v.string()),
  /** Discussion lifecycle (orthogonal to the retention `status` field). */
  discussionStatus: v.optional(
    v.union(v.literal('open'), v.literal('resolved'), v.literal('locked')),
  ),
  discussionCategory: v.optional(v.string()),
  /** Agent-to-agent reply-chain depth for the comment-thread loop guard. */
  agentReplyDepth: v.optional(v.number()),
  /** RETIRED (project discussions): admitted only until the purge runs. */
  acceptedAnswerMessageId: v.optional(v.string()),
  /** RETIRED (project discussions): admitted only until the purge runs. */
  linkedTaskId: v.optional(v.id('tasks')),
  /** RETIRED (project discussions): admitted only until the purge runs. */
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
  .index('by_org_user', ['organizationId', 'userId'])
  .index('by_organizationId_and_status', ['organizationId', 'status'])
  .index('by_organizationId_and_projectId', ['organizationId', 'projectId'])
  .index('by_projectId_and_userId', ['projectId', 'userId'])
  .index('by_kind_taskId', ['kind', 'taskId'])
  .index('by_org_automation_subject', [
    'organizationId',
    'automationSlug',
    'subjectType',
    'subjectId',
  ])
  .index('by_generationStatus', ['generationStatus']);
