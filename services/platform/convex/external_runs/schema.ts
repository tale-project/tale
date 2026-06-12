import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { taskAgentRunTriggerValidator } from '../task_metrics/schema';

/**
 * External agent runs — task work dispatched to a `tale-daemon` runtime
 * (Claude Code / Codex / OpenCode CLIs on a user's machine) instead of the
 * internal LLM loop.
 *
 * State machine (transitions are guarded in `internal_mutations.ts`; every
 * terminal transition also finalizes the unified `taskAgentRuns` row, so
 * external work never vanishes from metrics or budgets):
 *
 *   queued ──claim──▶ claimed ──started event──▶ running ──▶ completed
 *      │                 │                          │      └▶ failed
 *      │                 └──lease expiry──▶ queued (attempt < max) | failed
 *      └──2-min dispatch deadline──▶ failed(runtime_offline)
 *   any non-terminal ──cancelRequested + ack/sweep──▶ cancelled
 *
 * The PROMPT is frozen server-side at enqueue (untrusted-delimited, same
 * builder as internal runs) and stored INLINE so retention/erasure deletes
 * are atomic with the row — no orphaned blobs. Guard inputs (budget,
 * concurrency cap) are frozen at enqueue too: the claim-side re-check runs
 * in a mutation, which cannot read agent JSON files.
 */

export const externalRunStatusValidator = v.union(
  v.literal('queued'),
  v.literal('claimed'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('cancelled'),
);

export const externalRunPermissionModeValidator = v.union(
  v.literal('safe'),
  v.literal('auto_edits'),
  v.literal('full_auto'),
);

export const externalRunsTable = defineTable({
  organizationId: v.string(),
  taskId: v.id('tasks'),
  projectId: v.id('projects'),
  agentSlug: v.string(),
  adapterType: v.string(),
  /** Pin to one daemon (from the agent config); absent = any org daemon. */
  daemonId: v.optional(v.string()),
  workspaceKey: v.optional(v.string()),
  permissionMode: externalRunPermissionModeValidator,
  kind: v.union(v.literal('initial'), v.literal('revision')),
  /** Why this run exists — recorded onto the unified taskAgentRuns row. */
  trigger: taskAgentRunTriggerValidator,
  /** Adapter session ref of the run this revision resumes, when supported. */
  resumeSessionRef: v.optional(v.string()),
  /** Frozen server-assembled prompt (PII-dense; deleted with the row). */
  prompt: v.string(),

  status: externalRunStatusValidator,
  failReason: v.optional(v.string()),
  attempts: v.number(),
  maxAttempts: v.number(),
  cancelRequested: v.optional(v.boolean()),

  claimedByDaemonId: v.optional(v.string()),
  leaseExpiresAt: v.optional(v.number()),

  /** Frozen guard inputs from the agent config at enqueue time. */
  guardBudget: v.optional(
    v.object({
      monthlyCents: v.number(),
      warnPct: v.optional(v.number()),
      pausePct: v.optional(v.number()),
    }),
  ),
  guardMaxConcurrentTasks: v.optional(v.number()),

  /** Unified metrics row, created at claim through `startTaskAgentRun`. */
  runId: v.optional(v.id('taskAgentRuns')),
  wfExecutionId: v.optional(v.string()),
  workflowSlug: v.optional(v.string()),

  /** Adapter session ref returned on completion — resume handle. */
  sessionRef: v.optional(v.string()),
  resultSummary: v.optional(v.string()),
  diffStat: v.optional(v.string()),

  createdAt: v.number(),
  dispatchDeadlineAt: v.number(),
  claimedAt: v.optional(v.number()),
  startedAt: v.optional(v.number()),
  timeoutAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
})
  .index('by_org_status', ['organizationId', 'status'])
  .index('by_org_adapter_status', ['organizationId', 'adapterType', 'status'])
  .index('by_org_agent_status', ['organizationId', 'agentSlug', 'status'])
  .index('by_org_created', ['organizationId', 'createdAt'])
  .index('by_task', ['taskId'])
  .index('by_daemon_status', ['claimedByDaemonId', 'status']);

export const EXTERNAL_DISPATCH_DEADLINE_MS = 2 * 60 * 1000;
export const EXTERNAL_RUN_TIMEOUT_MS = 30 * 60 * 1000;
export const EXTERNAL_CLAIM_LEASE_MS = 60 * 1000;
export const EXTERNAL_MAX_ATTEMPTS = 2;
export const EXTERNAL_PROMPT_MAX_CHARS = 60_000;
