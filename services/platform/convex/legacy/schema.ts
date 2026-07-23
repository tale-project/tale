/**
 * FROZEN table declarations for the retired AI backend.
 *
 * The modules that owned these tables are retired;
 * their data still exists on running deployments, and Convex refuses to push a
 * schema that omits a non-empty table. Each table below is reproduced EXACTLY
 * as it was defined before the retirement — every field validator and every
 * `.index(...)` (name + field list) byte-faithful to the last shipped
 * source — so existing rows keep validating under their real shape and the
 * live code that still queries these tables by index (governance retention/
 * erasure, task metrics, discussions, migrations) keeps working. This is a
 * FROZEN DATA CONTRACT, not a permissive placeholder: nothing in the live
 * tree may read or write these tables, and no field/index here may be
 * loosened, renamed, or dropped outside of the rewrite phase that owns it
 * (see the ownership map below) shipping a real migration.
 *
 * A few validators/constants these schemas depended on lived in modules that
 * were ALSO retired (not just re-homed, but deleted along with their owning
 * feature) — those are inlined below as local consts with a comment naming
 * the retired source module, instead of an import path that would no longer
 * resolve. Everything else is imported from the live modules that still
 * exist (`lib/storage/blob_ref`, `lib/validators/json`,
 * `governance/soft_delete_validators`).
 *
 * Ownership — the rewrite of each domain migrates or drops its tables and
 * deletes its line here:
 * - integrations rebuild:   integrationCredentials, slackThreads
 * - automation rebuild:     automationInstallations, automationProjectBindings,
 *                           automationUploadClaims, automationUploadIntents,
 *                           wfEventSubscriptions, wfExecutions, wfInstallations,
 *                           wfDefaultProvisions, wfSchedules, wfTriggerLogs,
 *                           workflowEnv
 * - chat rebuild:           agentBindings, agentInstallations,
 *                           agentGuardrailNotices, agentWebhooks,
 *                           agentWebhookUserThreads, taskAgentRuns,
 *                           taskMetricsDaily, threadMetadata, threadBranches,
 *                           threadFiles, threadTodos, messageMetadata,
 *                           ttsAudioChunks, userMemories, userMemoryAuditLog
 * - knowledge rebuild:      knowledgeEntries
 */

import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';
import { blobRefValidator } from '../lib/storage/blob_ref';
import {
  jsonRecordValidator,
  jsonValueValidator,
} from '../lib/validators/json';

// -----------------------------------------------------------------------------
// retired convex/agents/schema.ts
// -----------------------------------------------------------------------------

export const knowledgeFileRagStatusValidator = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
);

/** One knowledge file bound to an agent (RAG-indexed upload). */
export const knowledgeFileValidator = v.object({
  fileId: blobRefValidator,
  fileName: v.string(),
  fileSize: v.optional(v.number()),
  extension: v.optional(v.string()),
  ragStatus: v.optional(knowledgeFileRagStatusValidator),
  ragIndexedAt: v.optional(v.number()),
  ragError: v.optional(v.string()),
});

/**
 * Slim binding table for agent-specific Convex resources (knowledge files,
 * team). Agent config itself lives in JSON files on disk; a DB record is
 * optional — agents work without one, created on first use.
 */
export const agentBindingsTable = defineTable({
  organizationId: v.string(),
  agentSlug: v.string(),
  teamId: v.optional(v.string()),
  sharedWithTeamIds: v.optional(v.array(v.string())),
  knowledgeFiles: v.optional(v.array(knowledgeFileValidator)),
})
  .index('by_organization', ['organizationId'])
  .index('by_org_agent', ['organizationId', 'agentSlug'])
  .index('by_team', ['teamId']);

/** Agent install + enable + provenance per org — gates routing/@mention/roster. */
export const agentInstallationsTable = defineTable({
  organizationId: v.string(),
  agentSlug: v.string(),
  installedAt: v.number(),
  installedBy: v.string(),
  contentHash: v.string(),
  enabled: v.boolean(),
  disabledReason: v.optional(
    v.union(v.literal('integration_disabled'), v.literal('user')),
  ),
  /** @deprecated retired integration-bundles cascade; kept so legacy rows validate. */
  bundledBy: v.optional(v.string()),
  /** Set iff this agent belongs to an installed app (`<automationSlug>/<name>`). */
  automationSlug: v.optional(v.string()),
})
  .index('by_organization', ['organizationId'])
  .index('by_org_slug', ['organizationId', 'agentSlug'])
  .index('by_org_bundledBy', ['organizationId', 'bundledBy']);

// -----------------------------------------------------------------------------
// retired convex/agents/guardrails/schema.ts
// -----------------------------------------------------------------------------

export const guardrailNoticeKindValidator = v.union(
  v.literal('budget_warn'),
  v.literal('budget_paused'),
  v.literal('circuit_tripped'),
  v.literal('concurrency_queued'),
);

/**
 * Threshold-crossing dedupe + queued-work ledger for agent guardrails. A
 * row's existence is the dedupe; unresolved `concurrency_queued` rows double
 * as the FIFO wake queue for freed slots.
 */
export const agentGuardrailNoticesTable = defineTable({
  organizationId: v.string(),
  agentSlug: v.string(),
  kind: guardrailNoticeKindValidator,
  /** Dedupe scope key: 'YYYY-MM' for budget kinds, String(taskId) otherwise. */
  periodKey: v.string(),
  thresholdPct: v.optional(v.number()),
  taskId: v.optional(v.id('tasks')),
  projectId: v.optional(v.id('projects')),
  /** Which cap queued this task ('agent' | 'org') — concurrency_queued only. */
  capScope: v.optional(v.string()),
  createdAt: v.number(),
  resolvedAt: v.optional(v.number()),
})
  .index('by_org_agent_kind_period', [
    'organizationId',
    'agentSlug',
    'kind',
    'periodKey',
  ])
  .index('by_org_kind_resolved', ['organizationId', 'kind', 'resolvedAt'])
  .index('by_org_agent_kind_resolved', [
    'organizationId',
    'agentSlug',
    'kind',
    'resolvedAt',
  ]);

// -----------------------------------------------------------------------------
// retired convex/agents/webhooks/schema.ts
// -----------------------------------------------------------------------------

export const agentWebhooksTable = defineTable({
  organizationId: v.string(),
  agentSlug: v.string(),
  token: v.string(),
  isActive: v.boolean(),
  lastTriggeredAt: v.optional(v.number()),
  createdAt: v.number(),
  /** Display value (email or user _id) shown in admin UIs. */
  createdBy: v.string(),
  /** Better Auth user id of the webhook creator; optional for backward-compat. */
  createdByUserId: v.optional(v.string()),
})
  .index('by_org', ['organizationId'])
  .index('by_agent', ['organizationId', 'agentSlug'])
  .index('by_token', ['token']);

/**
 * Maps a hashed client-supplied `user` field to a stable conversation thread
 * for a given agent webhook, so repeated posts with the same `user` land in
 * the same agent thread.
 */
export const agentWebhookUserThreadsTable = defineTable({
  webhookId: v.id('agentWebhooks'),
  organizationId: v.string(),
  userHash: v.string(),
  threadId: v.string(),
  createdAt: v.number(),
})
  .index('by_webhookId_userHash', ['webhookId', 'userHash'])
  .index('by_threadId', ['threadId'])
  .index('by_organizationId', ['organizationId']);

// -----------------------------------------------------------------------------
// retired convex/task_metrics/schema.ts
//
// (Placed before external_runs/schema.ts below, which imports
// `taskAgentRunTriggerValidator` from this module in the original tree — the
// dependency direction is preserved even though the task's file list orders
// external_runs first.)
// -----------------------------------------------------------------------------

/** What initiated an agent run on a task (recorded for metrics attribution). */
export const taskAgentRunTriggerValidator = v.union(
  v.literal('assignment'),
  v.literal('mention'),
  v.literal('revision'),
  v.literal('sla_escalation'),
  v.literal('unblock'),
  v.literal('decomposition'),
  v.literal('manual'),
);

export const taskAgentRunStatusValidator = v.union(
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('timed_out'),
);

export const taskAgentRunOutcomeValidator = v.union(
  v.literal('output_posted'),
  v.literal('escalated'),
  v.literal('error'),
  v.literal('automation_disabled'),
);

/**
 * Single source of truth for agent work on tasks — internal LLM-loop,
 * workflow-triggered, and external-runtime (daemon) runs all write through
 * this table. Cost-per-task, per-agent aggregates, the circuit-breaker
 * window, and concurrency counters all derive from these rows.
 */
export const taskAgentRunsTable = defineTable({
  organizationId: v.string(),
  // Denormalized from the task so project-scoped metrics never join.
  projectId: v.id('projects'),
  taskId: v.id('tasks'),
  // REAL agent slug — never the workflow step slug.
  agentSlug: v.string(),
  trigger: taskAgentRunTriggerValidator,
  wfExecutionId: v.optional(v.id('wfExecutions')),
  workflowSlug: v.optional(v.string()),
  /** Workflow step slug; dedup key so a re-entering step reuses this row. */
  stepSlug: v.optional(v.string()),
  threadId: v.optional(v.string()),
  status: taskAgentRunStatusValidator,
  outcome: v.optional(taskAgentRunOutcomeValidator),
  error: v.optional(v.string()),
  // Usage accrued incrementally; failed runs keep their accrued cost.
  inputTokens: v.number(),
  outputTokens: v.number(),
  costCents: v.number(),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  durationMs: v.optional(v.number()),
})
  .index('by_task_started', ['taskId', 'startedAt'])
  .index('by_org_agent_started', ['organizationId', 'agentSlug', 'startedAt'])
  .index('by_org_started', ['organizationId', 'startedAt'])
  .index('by_org_status', ['organizationId', 'status'])
  .index('by_org_agent_status', ['organizationId', 'agentSlug', 'status'])
  .index('by_project_status', ['projectId', 'status'])
  .index('by_wfExecution', ['wfExecutionId']);

/** Per-status accumulators keyed by the four non-terminal statuses. */
const perOpenStatusNumbers = v.object({
  backlog: v.number(),
  todo: v.number(),
  in_progress: v.number(),
  in_review: v.number(),
});

/**
 * Daily per-project rollup. Sums + counts are stored (never pre-averaged) so
 * re-aggregation stays exact; recomputed whole per (org, project, day).
 */
export const taskMetricsDailyTable = defineTable({
  organizationId: v.string(),
  projectId: v.id('projects'),
  // UTC day key 'YYYY-MM-DD'.
  dateKey: v.string(),

  tasksCreated: v.number(),
  tasksCompleted: v.number(),
  tasksCancelled: v.number(),

  // Cycle time: first in_progress -> done. Lead time: created -> done.
  cycleTimeSumMs: v.number(),
  cycleTimeCount: v.number(),
  leadTimeSumMs: v.number(),
  leadTimeCount: v.number(),

  // Time-in-status dwell, clipped to the day so sums are additive.
  timeInStatusMs: perOpenStatusNumbers,
  timeInStatusExits: perOpenStatusNumbers,

  // End-of-day snapshot -> cumulative-flow chart.
  statusCountsEod: perOpenStatusNumbers,
  wipEod: v.number(),
  blockedEod: v.number(),
  overdueEod: v.number(),
  staleEod: v.number(),

  agentCompleted: v.number(),
  humanCompleted: v.number(),

  agentRunsStarted: v.number(),
  agentRunsCompleted: v.number(),
  agentRunsFailed: v.number(),
  totalCostCents: v.number(),

  reviewsPassed: v.number(),
  reviewsChangesRequested: v.number(),
  escalations: v.number(),

  /** True when a bounded scan hit its cap — the day's numbers are lower bounds. */
  capped: v.boolean(),
  computedAt: v.number(),
  version: v.number(),
})
  .index('by_org_project_date', ['organizationId', 'projectId', 'dateKey'])
  .index('by_org_date', ['organizationId', 'dateKey']);

// -----------------------------------------------------------------------------
// retired convex/threads/schema.ts
//
// autoRouteReasonValidator / toolUsageItemValidator / contextStatsValidator /
// citationItemValidator below are inlined from the retired
// streaming/validators.ts module.
// They are shared by threadMetadataTable.liveRoute (here) and
// messageMetadataTable (streaming/schema.ts group, further down this file).
// chatTypeValidator / threadStatusValidator are inlined from the retired
// threads/validators.ts module.
// -----------------------------------------------------------------------------

export const autoRouteReasonValidator = v.union(
  v.literal('single-candidate'),
  v.literal('trivial'),
  v.literal('cached'),
  v.literal('classified'),
  v.literal('fallback'),
);

export const toolUsageItemValidator = v.object({
  toolName: v.string(),
  model: v.optional(v.string()),
  provider: v.optional(v.string()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
  durationMs: v.optional(v.number()),
  input: v.optional(v.string()),
  output: v.optional(v.string()),
  costEstimateCents: v.optional(v.number()),
});

export const contextStatsValidator = v.object({
  totalTokens: v.number(),
  messageCount: v.number(),
  approvalCount: v.number(),
  hasRag: v.boolean(),
  hasWebContext: v.optional(v.boolean()),
  hasIntegrations: v.optional(v.boolean()),
});

export const citationItemValidator = v.object({
  index: v.number(),
  type: v.union(v.literal('rag'), v.literal('web')),
  source: v.string(),
  fileId: v.optional(v.string()),
  url: v.optional(v.string()),
  page: v.optional(v.number()),
  relevance: v.optional(v.number()),
});

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
  /** Discussions reuse this thread/message store; `kind` distinguishes them. */
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
  acceptedAnswerMessageId: v.optional(v.string()),
  /** A task spawned from this discussion. */
  linkedTaskId: v.optional(v.id('tasks')),
  /** Agent-to-agent reply-chain depth for the discussion loop guard. */
  agentReplyDepth: v.optional(v.number()),
  /** Capability-group ids the model unlocked via `request_capabilities`. */
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
  .index('by_kind_projectId', ['kind', 'projectId'])
  .index('by_kind_taskId', ['kind', 'taskId'])
  .index('by_org_automation_subject', [
    'organizationId',
    'automationSlug',
    'subjectType',
    'subjectId',
  ])
  .index('by_generationStatus', ['generationStatus']);

// -----------------------------------------------------------------------------
// retired convex/threads/branch_schema.ts
// -----------------------------------------------------------------------------

export const threadBranchesTable = defineTable({
  rootThreadId: v.string(),
  branchThreadId: v.string(),
  parentThreadId: v.string(),
  forkAfterMessageId: v.string(),
  forkOrder: v.number(),
  /** `_creationTime` of the message at forkOrder — when the branch diverged. */
  forkOrderCreatedAt: v.optional(v.number()),
  branchIndex: v.number(),
  createdAt: v.number(),
})
  .index('by_rootThreadId', ['rootThreadId'])
  .index('by_parentThreadId_forkAfterMessageId', [
    'parentThreadId',
    'forkAfterMessageId',
  ])
  .index('by_branchThreadId', ['branchThreadId']);

// -----------------------------------------------------------------------------
// retired convex/thread_files/schema.ts
// -----------------------------------------------------------------------------

/**
 * Thread workspace files — every file the LLM writes (`file_write`), every
 * chat upload, and every `run_code` sandbox-harvested file, keyed by
 * `(threadId, path)`.
 */
export const threadFilesTable = defineTable({
  organizationId: v.string(),
  threadId: v.string(),
  /** POSIX-relative path inside the thread workspace. */
  path: v.string(),
  storageId: blobRefValidator,
  size: v.number(),
  contentType: v.string(),
  sha256: v.optional(v.string()),
  source: v.union(
    v.literal('user_upload'),
    v.literal('agent_write'),
    v.literal('run_output'),
  ),
  /** Render override; defaults to extension-based inference. */
  renderHint: v.optional(
    v.union(
      v.literal('html'),
      v.literal('svg'),
      v.literal('mermaid'),
      v.literal('markdown'),
      v.literal('code'),
      v.literal('image'),
      v.literal('attachment'),
    ),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_thread_and_path', ['threadId', 'path'])
  .index('by_thread_and_updatedAt', ['threadId', 'updatedAt'])
  .index('by_organizationId', ['organizationId']);

// -----------------------------------------------------------------------------
// retired convex/thread_todos/schema.ts
// -----------------------------------------------------------------------------

export const todoStatusValidator = v.union(
  v.literal('pending'),
  v.literal('in_progress'),
  v.literal('done'),
  v.literal('failed'),
  v.literal('cancelled'),
);

export const todoSourceValidator = v.object({
  url: v.string(),
  title: v.optional(v.string()),
  score: v.optional(v.number()),
  publishedDate: v.optional(v.string()),
  capturedAt: v.number(),
});

export const todoItemValidator = v.object({
  id: v.string(),
  content: v.string(),
  status: todoStatusValidator,
  searchCount: v.number(),
  extractCount: v.number(),
  findingsSummary: v.optional(v.string()),
  failureReason: v.optional(v.string()),
  sources: v.optional(v.array(todoSourceValidator)),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/** Thread-scoped todo state for agents that use the update_todos tool. */
export const threadTodosTable = defineTable({
  organizationId: v.string(),
  threadId: v.string(),
  todos: v.array(todoItemValidator),
  activeTodoId: v.optional(v.string()),
  recentOpIds: v.array(v.string()),
  integrationCallCount: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_org_thread', ['organizationId', 'threadId'])
  .index('by_thread', ['threadId']);

// -----------------------------------------------------------------------------
// retired convex/streaming/schema.ts
//
// autoRouteReasonValidator / citationItemValidator / contextStatsValidator /
// toolUsageItemValidator are inlined above in the threads/schema.ts group —
// this table originally imported them from the same retired
// streaming/validators.ts module.
// -----------------------------------------------------------------------------

export const messageMetadataTable = defineTable({
  messageId: v.string(),
  threadId: v.string(),
  /** Tenancy partition for admin rollups; optional, backfilled for legacy rows. */
  organizationId: v.optional(v.string()),
  model: v.string(),
  provider: v.string(),
  agentSlug: v.optional(v.string()),
  /** Why Auto routed here; absent means the user pinned the agent. */
  autoRouteReason: v.optional(autoRouteReasonValidator),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
  reasoningTokens: v.optional(v.number()),
  cachedInputTokens: v.optional(v.number()),
  reasoning: v.optional(v.string()),
  providerMetadata: v.optional(jsonRecordValidator),
  durationMs: v.optional(v.number()),
  timeToFirstTokenMs: v.optional(v.number()),
  timeToFirstReasoningMs: v.optional(v.number()),
  timeFromSendMs: v.optional(v.number()),
  thinkingDurationMs: v.optional(v.number()),
  subAgentUsage: v.optional(v.array(toolUsageItemValidator)),
  toolsUsage: v.optional(v.array(toolUsageItemValidator)),
  citations: v.optional(v.array(citationItemValidator)),
  // Structured context window for debugging (XML-like formatted)
  contextWindow: v.optional(v.string()),
  contextStats: v.optional(contextStatsValidator),
  error: v.optional(v.string()),
  /** Set when guardrails block this message; UI checks before rendering. */
  blockedReason: v.optional(
    v.object({
      code: v.union(
        v.literal('pii.blocked'),
        v.literal('chat_filter.blocked'),
        v.literal('moderation_provider.blocked'),
      ),
      direction: v.union(v.literal('input'), v.literal('output')),
      categoryIds: v.array(v.string()),
      sanitizationRunId: v.string(),
    }),
  ),
  costEstimateCents: v.optional(v.number()),
})
  .index('by_messageId', ['messageId'])
  .index('by_threadId', ['threadId'])
  .index('by_organizationId', ['organizationId']);

// -----------------------------------------------------------------------------
// retired convex/tts/schema.ts
//
// audioFormatLiterals is inlined from the retired
// lib/shared/schemas/providers.ts module.
// ttsErrorCodeLiterals is inlined from the retired
// tts/error_codes.ts module.
// -----------------------------------------------------------------------------

/** Single source of truth for TTS output audio formats. */
const audioFormatLiterals = [
  'mp3',
  'opus',
  'aac',
  'flac',
  'wav',
  'pcm',
] as const;

/** Stable error tokens written to `ttsAudioChunks.error`. */
const ttsErrorCodeLiterals = [
  'NO_PROVIDER',
  'UNKNOWN_MODEL',
  'UNKNOWN_PROVIDER',
  'UNKNOWN_VOICE',
  'HOST_POLICY',
  'RATE_LIMITED',
  'CONTENTION',
  'BUDGET_EXCEEDED',
  'MESSAGE_CHAR_LIMIT',
  'TIMEOUT',
  'PROVIDER_AUTH',
  'PROVIDER_BAD_REQUEST',
  'PROVIDER_PAYLOAD_TOO_LARGE',
  'PROVIDER_4XX',
  'PROVIDER_5XX',
  'PROVIDER_INVALID_RESPONSE',
  'PROVIDER_ERROR',
  'WATCHDOG_TIMEOUT',
] as const;

/**
 * Per-chunk TTS audio for streaming voice-mode output. One row per
 * `(messageId, index)` sentence/paragraph slice.
 */
export const ttsAudioChunksTable = defineTable({
  messageId: v.string(),
  threadId: v.string(),
  organizationId: v.string(),
  /** User who triggered synthesis; optional for rows predating this field. */
  userId: v.optional(v.string()),
  teamId: v.optional(v.string()),
  agentSlug: v.optional(v.string()),
  index: v.number(),
  text: v.string(),
  storageId: v.optional(blobRefValidator),
  status: v.union(
    v.literal('pending'),
    v.literal('ready'),
    v.literal('failed'),
  ),
  error: v.optional(
    v.union(...ttsErrorCodeLiterals.map((literal) => v.literal(literal))),
  ),
  /** Identity token from `reserveChunk`, re-verified on every mark-* mutation. */
  attemptCreatedAt: v.optional(v.number()),
  usageRecordedAt: v.optional(v.number()),
  locale: v.string(),
  voice: v.optional(v.string()),
  providerName: v.optional(v.string()),
  modelId: v.optional(v.string()),
  characterCount: v.optional(v.number()),
  costEstimateCents: v.optional(v.number()),
  format: v.optional(
    v.union(...audioFormatLiterals.map((literal) => v.literal(literal))),
  ),
  createdAt: v.number(),
})
  .index('by_message', ['messageId', 'index'])
  .index('by_thread_age', ['threadId', 'createdAt'])
  .index('by_org_createdAt', ['organizationId', 'createdAt'])
  .index('by_user_org', ['userId', 'organizationId']);

// -----------------------------------------------------------------------------
// retired convex/user_memories/schema.ts
// -----------------------------------------------------------------------------

/** Per-user, per-org cross-thread memory entries ('pending' -> 'approved'). */
export const userMemoriesTable = defineTable({
  userId: v.string(),
  organizationId: v.string(),
  content: v.string(),
  source: v.union(v.literal('manual'), v.literal('agent_proposed')),
  status: v.union(v.literal('pending'), v.literal('approved')),
  sourceThreadId: v.optional(v.string()),
  sourceMessageId: v.optional(v.string()),
  createdAt: v.number(),
  pendingExpiresAt: v.optional(v.number()),
  deletedAt: v.optional(v.number()),
})
  .index('by_user_org_status_deleted_created', [
    'userId',
    'organizationId',
    'status',
    'deletedAt',
    'createdAt',
  ])
  .index('by_organizationId', ['organizationId']);

// -----------------------------------------------------------------------------
// retired convex/user_memory_audit_log/schema.ts
// -----------------------------------------------------------------------------

/**
 * Append-only audit log for personalization data lifecycle events. Schema is
 * closed (no free-form metadata) so every action's payload shape is
 * enumerated here.
 */
export const userMemoryAuditLogTable = defineTable({
  organizationId: v.string(),
  actorUserId: v.string(),
  subjectUserId: v.string(),
  action: v.union(
    v.literal('propose'),
    v.literal('create'),
    v.literal('approve'),
    v.literal('dismiss'),
    v.literal('delete'),
    v.literal('inject'),
  ),
  outcome: v.union(v.literal('ok'), v.literal('denied'), v.literal('error')),
  memoryId: v.optional(v.id('userMemories')),
  injectedMemoryIds: v.optional(v.array(v.id('userMemories'))),
  threadId: v.optional(v.string()),
  messageId: v.optional(v.string()),
  agentSlug: v.optional(v.string()),
  requestId: v.optional(v.string()),
  createdAt: v.number(),
  lifecycleStatus: v.optional(lifecycleStatusValidator),
  statusChangedAt: v.optional(v.number()),
})
  .index('by_org_subject_at', ['organizationId', 'subjectUserId', 'createdAt'])
  .index('by_org_at', ['organizationId', 'createdAt'])
  .index('by_org_lifecycleStatus', ['organizationId', 'lifecycleStatus']);

// -----------------------------------------------------------------------------
// retired convex/knowledge_entries/schema.ts
// -----------------------------------------------------------------------------

/**
 * User-contributed knowledge entries (chat `knowledge_write` tool or manual
 * authoring), keyed by normalized `topicKey`; at most one `active` row per
 * (org, topicKey).
 */
export const knowledgeEntriesTable = defineTable({
  organizationId: v.string(),
  topic: v.string(),
  topicKey: v.string(),
  content: v.string(),
  status: v.union(v.literal('active'), v.literal('superseded')),
  documentId: v.optional(v.id('documents')),
  source: v.union(v.literal('chat'), v.literal('manual')),
  sourceThreadId: v.optional(v.string()),
  sourceMessageId: v.optional(v.string()),
  createdBy: v.string(),
  createdAt: v.number(),
  supersededBy: v.optional(v.id('knowledgeEntries')),
  supersededAt: v.optional(v.number()),
  deletedAt: v.optional(v.number()),
})
  .index('by_org_topicKey_status', ['organizationId', 'topicKey', 'status'])
  .index('by_organizationId_and_status', ['organizationId', 'status'])
  .index('by_documentId', ['documentId'])
  .index('by_organizationId', ['organizationId']);

// -----------------------------------------------------------------------------
// retired convex/integrations/credentials_schema.ts
// -----------------------------------------------------------------------------

/**
 * Slim credentials table for installed integrations. Integration definitions
 * (operations, connector code, config) live in filesystem files under
 * `$TALE_CONFIG_DIR/<orgSlug>/integrations/<slug>/`; this table stores only
 * per-installation runtime data.
 */
export const integrationCredentialsTable = defineTable({
  organizationId: v.string(),
  slug: v.string(),
  status: v.union(
    v.literal('active'),
    v.literal('inactive'),
    v.literal('error'),
    v.literal('testing'),
  ),
  isActive: v.boolean(),
  authMethod: v.union(
    v.literal('api_key'),
    v.literal('bearer_token'),
    v.literal('basic_auth'),
    v.literal('oauth2'),
  ),
  supportedAuthMethods: v.optional(
    v.array(
      v.union(
        v.literal('api_key'),
        v.literal('bearer_token'),
        v.literal('basic_auth'),
        v.literal('oauth2'),
      ),
    ),
  ),
  apiKeyAuth: v.optional(
    v.object({
      keyEncrypted: v.string(),
      keyPrefix: v.optional(v.string()),
    }),
  ),
  basicAuth: v.optional(
    v.object({
      username: v.string(),
      passwordEncrypted: v.string(),
    }),
  ),
  /** SMTP-only credential for imap_smtp integrations; falls back to basicAuth. */
  smtpAuth: v.optional(
    v.object({
      username: v.string(),
      passwordEncrypted: v.string(),
    }),
  ),
  oauth2Auth: v.optional(
    v.object({
      accessTokenEncrypted: v.string(),
      refreshTokenEncrypted: v.optional(v.string()),
      tokenExpiry: v.optional(v.number()),
      scopes: v.optional(v.array(v.string())),
    }),
  ),
  oauth2Config: v.optional(
    v.object({
      authorizationUrl: v.string(),
      tokenUrl: v.string(),
      scopes: v.optional(v.array(v.string())),
      clientId: v.optional(v.string()),
      clientSecretEncrypted: v.optional(v.string()),
      /** Slack-only: signing secret to verify inbound Events API requests. */
      signingSecretEncrypted: v.optional(v.string()),
    }),
  ),
  // connectionConfig is integration-specific (e.g. model, region).
  connectionConfig: v.optional(v.any()),
  sqlConnectionConfig: v.optional(
    v.object({
      engine: v.union(
        v.literal('mssql'),
        v.literal('postgres'),
        v.literal('mysql'),
      ),
      server: v.optional(v.string()),
      port: v.optional(v.number()),
      database: v.optional(v.string()),
      readOnly: v.optional(v.boolean()),
      options: v.optional(
        v.object({
          encrypt: v.optional(v.boolean()),
          trustServerCertificate: v.optional(v.boolean()),
          connectionTimeout: v.optional(v.number()),
          requestTimeout: v.optional(v.number()),
        }),
      ),
      security: v.optional(
        v.object({
          maxResultRows: v.optional(v.number()),
          queryTimeoutMs: v.optional(v.number()),
          maxConnectionPoolSize: v.optional(v.number()),
        }),
      ),
    }),
  ),
  lastSyncedAt: v.optional(v.number()),
  lastTestedAt: v.optional(v.number()),
  lastSuccessAt: v.optional(v.number()),
  lastErrorAt: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
  syncStats: v.optional(
    v.object({
      totalRecords: v.optional(v.number()),
      lastSyncCount: v.optional(v.number()),
      failedSyncCount: v.optional(v.number()),
    }),
  ),
  capabilities: v.optional(
    v.object({
      canSync: v.optional(v.boolean()),
      canPush: v.optional(v.boolean()),
      canWebhook: v.optional(v.boolean()),
      syncFrequency: v.optional(v.string()),
    }),
  ),
  iconStorageId: v.optional(v.id('_storage')),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_slug', ['organizationId', 'slug'])
  .index('by_slug', ['slug'])
  .index('by_status', ['status']);

// -----------------------------------------------------------------------------
// retired convex/integrations/slack/schema.ts
// -----------------------------------------------------------------------------

/**
 * Maps a Slack conversation (org + channel + root thread ts) to a stable
 * Tale agent thread, so every reply within one Slack thread continues the
 * same agent conversation.
 */
export const slackThreadsTable = defineTable({
  organizationId: v.string(),
  channel: v.string(),
  /** Stable key for "this Slack conversation" (root ts, or 'im' for a DM). */
  conversationTs: v.string(),
  threadId: v.string(),
  slackUserId: v.string(),
  slackUserName: v.optional(v.string()),
  createdAt: v.number(),
})
  .index('by_conversation', ['organizationId', 'channel', 'conversationTs'])
  .index('by_threadId', ['threadId'])
  .index('by_organizationId', ['organizationId']);

// -----------------------------------------------------------------------------
// retired convex/automations/schema.ts
// -----------------------------------------------------------------------------

/**
 * One row per installed automation per org — the org-level resource ledger.
 * An automation is installed by copying its bundle's resources into the
 * org's config dirs; this row is the activation record + copied-file ledger.
 */
export const automationInstallationsTable = defineTable({
  organizationId: v.string(),
  automationSlug: v.string(),
  /** Denormalized display name (from the manifest at install). */
  automationName: v.optional(v.string()),
  installedAt: v.number(),
  installedBy: v.string(),
  /** 'active' = all copied resources present; 'broken' = a copied file is gone. */
  status: v.union(v.literal('active'), v.literal('broken')),
  /** Transient teardown lock set by `uninstallAutomation` before FS teardown. */
  uninstalling: v.optional(v.boolean()),
  /** Integration slugs the automation requires connected (from the manifest). */
  requiredIntegrations: v.array(v.string()),
  /** The copied-file ledger: one entry per file materialized into the org. */
  resources: v.array(
    v.object({
      domain: v.string(),
      path: v.string(),
      contentHash: v.string(),
      /** Pre-existing org file the install would have overwritten; left in place. */
      adopted: v.optional(v.boolean()),
    }),
  ),
})
  .index('by_org', ['organizationId'])
  .index('by_org_slug', ['organizationId', 'automationSlug']);

/**
 * One row per (org, automationSlug, project): a `scope: 'project'`
 * automation's membership in a project. Shared org resources live once on
 * `automationInstallations`.
 */
export const automationProjectBindingsTable = defineTable({
  organizationId: v.string(),
  automationSlug: v.string(),
  projectId: v.id('projects'),
  boundAt: v.number(),
  boundBy: v.string(),
})
  .index('by_project', ['projectId'])
  .index('by_org_slug_project', [
    'organizationId',
    'automationSlug',
    'projectId',
  ]);

/**
 * Per-(org, slug) exclusion lock for `uploadAutomationBundle`'s
 * stage-then-rename swap. Mirrors `skillUploadClaims`.
 */
export const automationUploadClaimTable = defineTable({
  organizationId: v.string(),
  slug: v.string(),
  claimedAt: v.number(),
  expiresAt: v.number(),
}).index('by_org_slug', ['organizationId', 'slug']);

/**
 * Binds an `_storage` blob to the org + user that requested its upload URL,
 * for `uploadAutomationBundle`. Mirrors `skillUploadIntents`.
 */
export const automationUploadIntentTable = defineTable({
  storageId: v.id('_storage'),
  organizationId: v.string(),
  userId: v.string(),
  createdAt: v.number(),
}).index('by_storageId', ['storageId']);

// -----------------------------------------------------------------------------
// retired convex/workflows/schema.ts
//
// executionStatusValidator is inlined from the retired
// workflows/executions/validators.ts module.
// -----------------------------------------------------------------------------

const executionStatusValidator = v.union(
  v.literal('pending'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
);

export const wfExecutionsTable = defineTable({
  organizationId: v.string(),
  /** File-workflow slug string (DB-backed wfDefinitions removed). */
  wfDefinitionId: v.union(v.string(), v.null()),
  rootWfDefinitionId: v.optional(v.string()),
  workflowSlug: v.optional(v.string()),
  workflowVersion: v.optional(v.string()),
  status: executionStatusValidator,
  currentStepSlug: v.string(),
  currentStepName: v.optional(v.string()),
  loopProgress: v.optional(
    v.object({
      current: v.number(),
      total: v.number(),
    }),
  ),
  waitingFor: v.optional(v.string()),
  /** Sandbox step slug currently waiting on a free concurrency slot. */
  awaitingCapacityStepSlug: v.optional(v.string()),
  startedAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
  componentWorkflowId: v.optional(v.string()),
  shardIndex: v.optional(v.number()),
  userId: v.optional(v.string()),
  threadId: v.optional(v.string()),
  variables: v.optional(v.string()),
  variablesStorageId: v.optional(v.id('_storage')),
  input: v.optional(jsonValueValidator),
  output: v.optional(jsonValueValidator),
  outputStorageId: v.optional(v.id('_storage')),
  workflowConfig: v.optional(v.string()),
  stepsConfig: v.optional(v.string()),
  stepsConfigStorageId: v.optional(v.id('_storage')),
  triggeredBy: v.optional(v.string()),
  triggerData: v.optional(jsonValueValidator),
  /** Generic "what domain resource this run is about" (e.g. a task). */
  subjectType: v.optional(v.string()),
  subjectId: v.optional(v.string()),
  error: v.optional(v.string()),
  /** Coarse failure classification; plain string so new codes need no migration. */
  errorCode: v.optional(v.string()),
  metadata: v.optional(v.string()),
  lifecycleStatus: v.optional(lifecycleStatusValidator),
  statusChangedAt: v.optional(v.number()),
  /** Set once the first failed-transition notification has been sent. */
  failureNotifiedAt: v.optional(v.number()),
})
  .index('by_org', ['organizationId'])
  .index('by_org_lifecycleStatus', ['organizationId', 'lifecycleStatus'])
  .index('by_definition', ['wfDefinitionId'])
  .index('by_definition_status', ['wfDefinitionId', 'status'])
  .index('by_definition_startedAt', ['wfDefinitionId', 'startedAt'])
  .index('by_definition_triggeredBy_startedAt', [
    'wfDefinitionId',
    'triggeredBy',
    'startedAt',
  ])
  .index('by_status', ['status'])
  .index('by_org_status', ['organizationId', 'status'])
  .index('by_org_triggeredBy', ['organizationId', 'triggeredBy'])
  .index('by_component_workflow', ['componentWorkflowId'])
  .index('by_org_workflowSlug', ['organizationId', 'workflowSlug'])
  .index('by_org_workflowSlug_startedAt', [
    'organizationId',
    'workflowSlug',
    'startedAt',
  ])
  .index('by_org_workflowSlug_status', [
    'organizationId',
    'workflowSlug',
    'status',
  ])
  .index('by_org_user', ['organizationId', 'userId'])
  .index('by_org_subject', ['organizationId', 'subjectType', 'subjectId']);

export const wfInstallationsTable = defineTable({
  organizationId: v.string(),
  workflowSlug: v.string(),
  installedAt: v.number(),
  installedBy: v.string(),
  contentHash: v.string(),
  /** Set iff this workflow belongs to an installed app (`<automationSlug>/<name>`). */
  automationSlug: v.optional(v.string()),
})
  .index('by_org', ['organizationId'])
  .index('by_org_slug', ['organizationId', 'workflowSlug']);

/** One row per (org, workflow) the default-pack provisioner has handled. */
export const wfDefaultProvisionsTable = defineTable({
  organizationId: v.string(),
  workflowSlug: v.string(),
  contentHash: v.string(),
  provisionedAt: v.number(),
}).index('by_org_slug', ['organizationId', 'workflowSlug']);

/**
 * Per-workflow + per-step env/secrets, one row per
 * (org, workflowSlug, stepSlug, key).
 */
export const workflowEnvTable = defineTable({
  organizationId: v.string(),
  /** File-workflow slug (composite app slug ok, e.g. `issue-desk/desk-process`). */
  workflowSlug: v.string(),
  /** '' = workflow-level (all sandbox steps); non-empty = that step only. */
  stepSlug: v.string(),
  /** Env var name (validated `^[A-Za-z_][A-Za-z0-9_]*$`). */
  key: v.string(),
  isSecret: v.boolean(),
  /** Plaintext value for non-secret vars; omitted for secrets. */
  value: v.optional(v.string()),
  /** JWE ciphertext for secrets; omitted for non-secret vars. */
  encryptedValue: v.optional(v.string()),
  /** Low-leak edge preview of a secret; omitted for non-secret vars. */
  maskedPreview: v.optional(v.string()),
  updatedAt: v.number(),
  updatedBy: v.string(),
})
  .index('by_org_workflow', ['organizationId', 'workflowSlug'])
  .index('by_org_workflow_step', ['organizationId', 'workflowSlug', 'stepSlug'])
  .index('by_org_workflow_step_key', [
    'organizationId',
    'workflowSlug',
    'stepSlug',
    'key',
  ]);

// -----------------------------------------------------------------------------
// retired convex/workflows/triggers/schema.ts
// -----------------------------------------------------------------------------

export const wfSchedulesTable = defineTable({
  organizationId: v.string(),
  /** Project this schedule belongs to, for a project-scope app; absent = org-level. */
  projectId: v.optional(v.id('projects')),
  workflowSlug: v.optional(v.string()),
  cronExpression: v.string(),
  timezone: v.string(),
  isActive: v.boolean(),
  lastTriggeredAt: v.optional(v.number()),
  createdAt: v.number(),
  createdBy: v.string(),
  variables: v.optional(jsonRecordValidator),
})
  .index('by_org', ['organizationId'])
  .index('by_workflowSlug', ['workflowSlug'])
  .index('by_org_active', ['organizationId', 'isActive']);

export const wfEventSubscriptionsTable = defineTable({
  organizationId: v.string(),
  workflowSlug: v.optional(v.string()),
  eventType: v.string(),
  eventFilter: v.optional(v.record(v.string(), v.string())),
  isActive: v.boolean(),
  lastTriggeredAt: v.optional(v.number()),
  createdAt: v.number(),
  createdBy: v.string(),
})
  .index('by_org', ['organizationId'])
  .index('by_workflowSlug', ['workflowSlug'])
  .index('by_org_eventType', ['organizationId', 'eventType']);

export const wfTriggerLogsTable = defineTable({
  organizationId: v.string(),
  workflowSlug: v.optional(v.string()),
  wfDefinitionId: v.optional(v.string()),
  wfExecutionId: v.optional(v.id('wfExecutions')),
  triggerType: v.union(
    v.literal('manual'),
    v.literal('schedule'),
    v.literal('webhook'),
    v.literal('api'),
    v.literal('event'),
  ),
  status: v.union(
    v.literal('accepted'),
    v.literal('rejected'),
    v.literal('duplicate'),
    v.literal('rate_limited'),
  ),
  idempotencyKey: v.optional(v.string()),
  ipAddress: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  receivedAt: v.number(),
})
  .index('by_org', ['organizationId'])
  .index('by_workflowSlug', ['workflowSlug'])
  .index('by_idempotencyKey', ['organizationId', 'idempotencyKey']);
