/**
 * DEFERRED-DROP table declarations — the tail of the retired AI backend the
 * 0.4 baseline reset could not yet remove.
 *
 * 0.4 is a breaking cutover (fresh deploy only, empty migration history —
 * see `../migrations/framework/baseline.ts`), so these tables are forever
 * empty on every deployment: nothing in the live tree inserts into them.
 * They stay declared for one reason only — live schemas still reference
 * their ids structurally, and unpicking those fields belongs to the owning
 * domains, not to the reset:
 *
 * - `taskAgentRuns`   — `sandboxSessions.taskRunId` (`sandbox/sessions_schema.ts`)
 *                       plus the task-timeline / task-run read paths.
 * - `wfExecutions`    — `tasks.wfExecutionId` (`tasks/schema.ts`),
 *                       `approvals.wfExecutionId` + its `by_execution` index
 *                       (`approvals/schema.ts`), sandbox admission dedup, and
 *                       the retired review-card plumbing.
 *
 * Dropping either = remove the referencing fields/read paths in its owning
 * domain, delete the declaration here, and ship a trivial drop migration
 * through the framework (the snapshot gate requires one). Both are tracked
 * as 0.4.x follow-ups; nothing new may ever write these tables.
 */

import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';
import { jsonValueValidator } from '../lib/validators/json';

// -----------------------------------------------------------------------------
// retired convex/task_agents/schema.ts
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// retired convex/wf_engine/schema.ts
// -----------------------------------------------------------------------------

// executionStatusValidator is inlined from the retired wf_engine validators.
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
