import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Workforce-guardrails schema: the concurrency semaphore and the
 * notice/dedupe ledger behind per-agent budgets, concurrency caps, and the
 * per-task circuit breaker.
 */

/**
 * OCC-serialized concurrency semaphore — one row per scope, where scope is
 * `agent:<slug>` (per-agent running count) or `org` (org-wide running count).
 *
 * Why a counter row instead of counting `taskAgentRuns` by index inside the
 * admission mutation: Convex OCC does not detect range-phantoms, so two
 * racing admissions could both count N running rows and both admit at the
 * cap (the documented claim-row doctrine on `activeLegalHoldClaimsTable`).
 * Concurrent writers contending on this single row serialize instead.
 *
 * Incremented/decremented ONLY by `task_metrics/internal_mutations.ts`
 * (`startTaskAgentRun` / `finalizeTaskAgentRun`) — exactly one writer pair.
 * A reconciliation cron heals drift from crashed actions by recomputing the
 * true counts from `taskAgentRuns.by_org_agent_status`.
 */
export const agentRunCountersTable = defineTable({
  organizationId: v.string(),
  /** 'agent:<slug>' for per-agent rows; 'org' for the org-wide row. */
  scope: v.string(),
  running: v.number(),
  updatedAt: v.number(),
}).index('by_org_scope', ['organizationId', 'scope']);

export const guardrailNoticeKindValidator = v.union(
  // periodKey = monthly 'YYYY-MM' — month rollover resets budget notices.
  v.literal('budget_warn'),
  v.literal('budget_paused'),
  // periodKey = String(taskId) — one-shot per task (and per agent for trips).
  v.literal('circuit_tripped'),
  // periodKey = String(taskId); resolvedAt set when the queued task is woken.
  v.literal('concurrency_queued'),
);

/**
 * Threshold-crossing dedupe + queued-work ledger. A row's EXISTENCE is the
 * dedupe: "notify once per threshold-crossing per scope" is enforced by
 * check-then-insert on `by_org_agent_kind_period` inside a mutation.
 * Unresolved `concurrency_queued` rows double as the FIFO wake queue for
 * `agent.slot_freed` (oldest unresolved notice is woken when a slot frees).
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
