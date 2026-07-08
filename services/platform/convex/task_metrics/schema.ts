import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Task-metrics schema: the run record every agent execution on a task writes
 * through, plus the pre-aggregated daily rollups the dashboards read.
 *
 * `taskAgentRuns` is the SINGLE source of truth for agent work on tasks —
 * internal LLM-loop runs, workflow-triggered runs, and external-runtime runs
 * (daemon CLIs) all go through the same start/record/finalize internal
 * mutations. Cost-per-task, the per-agent aggregates, the
 * per-(task, agent) circuit-breaker window, and the concurrency counters all
 * derive from these rows; a run path that bypasses them silently vanishes
 * from budgets and KPIs.
 */

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

export const taskAgentRunsTable = defineTable({
  organizationId: v.string(),
  // Denormalized from the task so project-scoped metrics never join.
  projectId: v.id('projects'),
  taskId: v.id('tasks'),
  // REAL agent slug — never the workflow step slug (the workflow LLM node's
  // `agentSlug = stepSlug` ledger habit must not leak in here).
  agentSlug: v.string(),
  trigger: taskAgentRunTriggerValidator,
  // The workflow execution that dispatched this run, when there is one, plus
  // its slug so the task detail sheet can deep-link straight into the
  // automations execution view without a join.
  wfExecutionId: v.optional(v.id('wfExecutions')),
  workflowSlug: v.optional(v.string()),
  // Thread the agent worked in (per-task agent thread). Used by the cost
  // reconciliation safety net (messageMetadata by_threadId).
  threadId: v.optional(v.string()),
  status: taskAgentRunStatusValidator,
  outcome: v.optional(taskAgentRunOutcomeValidator),
  error: v.optional(v.string()),
  // Usage accrued incrementally via recordTaskRunUsage; failed runs keep
  // their accrued cost (the money was spent).
  inputTokens: v.number(),
  outputTokens: v.number(),
  costCents: v.number(),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  durationMs: v.optional(v.number()),
})
  // Run history per task, ordered — also the circuit-breaker rolling window
  // (count runs with startedAt > now - window for (taskId, agentSlug)).
  .index('by_task_started', ['taskId', 'startedAt'])
  // Agent scorecard recent-runs + per-agent day windows.
  .index('by_org_agent_started', ['organizationId', 'agentSlug', 'startedAt'])
  // Daily rollup day-window scan.
  .index('by_org_started', ['organizationId', 'startedAt'])
  // Live "running now" counts + stuck-run sweep.
  .index('by_org_status', ['organizationId', 'status'])
  // Per-agent concurrency reconciliation.
  .index('by_org_agent_status', ['organizationId', 'agentSlug', 'status'])
  // Board working-indicators (one bounded read per open board).
  .index('by_project_status', ['projectId', 'status'])
  .index('by_wfExecution', ['wfExecutionId']);

/**
 * Per-status accumulators keyed by the four NON-terminal statuses. Dwell time
 * in done/cancelled is meaningless; terminal counts live in dedicated fields.
 */
const perOpenStatusNumbers = v.object({
  backlog: v.number(),
  todo: v.number(),
  in_progress: v.number(),
  in_review: v.number(),
});

/**
 * Daily per-project rollup. Sums + counts are stored (never pre-averaged) so
 * re-aggregation across days/projects stays exact. Rows are recomputed whole
 * (idempotent delete-and-rewrite per (org, project, day)) by the rollup cron.
 */
export const taskMetricsDailyTable = defineTable({
  organizationId: v.string(),
  projectId: v.id('projects'),
  // UTC day key 'YYYY-MM-DD' (matches the usage/workflow metrics convention).
  dateKey: v.string(),

  tasksCreated: v.number(),
  tasksCompleted: v.number(),
  tasksCancelled: v.number(),

  // Cycle time: first in_progress -> done. Lead time: created -> done.
  cycleTimeSumMs: v.number(),
  cycleTimeCount: v.number(),
  leadTimeSumMs: v.number(),
  leadTimeCount: v.number(),

  // Time-in-status dwell, clipped to the day so sums are additive across days.
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

  // True when a bounded scan hit its cap — the day's numbers are lower bounds.
  capped: v.boolean(),
  computedAt: v.number(),
  version: v.number(),
})
  .index('by_org_project_date', ['organizationId', 'projectId', 'dateKey'])
  .index('by_org_date', ['organizationId', 'dateKey']);

/** Daily per-agent rollup (per-agent aggregates + trends). */
export const agentTaskMetricsDailyTable = defineTable({
  organizationId: v.string(),
  agentSlug: v.string(),
  dateKey: v.string(),

  runsStarted: v.number(),
  runsCompleted: v.number(),
  runsFailed: v.number(),
  runDurationSumMs: v.number(),
  runDurationCount: v.number(),

  inputTokens: v.number(),
  outputTokens: v.number(),
  costCents: v.number(),

  tasksCompleted: v.number(),
  reviewsPassed: v.number(),
  reviewsChangesRequested: v.number(),
  escalations: v.number(),
  staleEod: v.number(),

  computedAt: v.number(),
})
  .index('by_org_agent_date', ['organizationId', 'agentSlug', 'dateKey'])
  .index('by_org_date', ['organizationId', 'dateKey']);
