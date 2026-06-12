/**
 * Pure guardrail decision logic (no ctx, fully unit-testable).
 *
 * One evaluator covers every run entry point; the CONTEXT decides which
 * rules apply:
 *
 *  - BUDGET applies to ALL contexts: an agent past its monthly pause
 *    threshold runs nothing, anywhere. Past the warn threshold it still
 *    runs, with an economy instruction injected into its prompt.
 *  - CONCURRENCY (per-agent + org-wide) applies ONLY to the autonomous task
 *    contexts ('task_run' | 'external_enqueue' | 'external_claim').
 *    Interactive chat turns and delegation sub-steps are deliberately
 *    exempt: they are synchronous, human-attended, already bounded by the
 *    parent action's time budget — capping them would stall a live
 *    conversation, which is worse than the marginal capacity risk.
 *  - The per-task CIRCUIT BREAKER applies when a taskId is present
 *    ('task_run' | 'external_enqueue'): a paused task, or one at the
 *    runs-per-hour cap, refuses further automated runs until a HUMAN
 *    changes the task status.
 *
 * Precedence on multiple violations: budget_paused > task_circuit_breaker >
 * agent_concurrency > org_concurrency — a budget-dead agent must trigger
 * the reassignment automation, not sit in a concurrency queue.
 */

export type GuardContext =
  | 'task_run'
  | 'delegation'
  | 'external_enqueue'
  | 'external_claim'
  | 'chat_turn';

export interface GuardBudget {
  monthlyCents: number;
  warnPct?: number;
  pausePct?: number;
}

export const BUDGET_WARN_PCT_DEFAULT = 80;
export const BUDGET_PAUSE_PCT_DEFAULT = 100;

export interface GuardFacts {
  monthSpentCents: number;
  budget?: GuardBudget;
  /** Currently running task runs for this agent (counter row, missing = 0). */
  agentRunning: number;
  /** Effective per-agent cap (config or policy fleet default); undefined = unlimited. */
  agentCap?: number;
  /** Currently running task runs org-wide. */
  orgRunning: number;
  orgCap: number;
  /** Agent runs on THIS task within the rolling window (when taskId given). */
  taskRunsLastHour?: number;
  taskCircuitCap: number;
  /** tasks.agentRunsPausedAt — set when the breaker already tripped. */
  taskPausedAt?: number;
}

export type GuardRefusalReason =
  | 'budget_paused'
  | 'task_circuit_breaker'
  | 'agent_concurrency'
  | 'org_concurrency';

export interface GuardVerdict {
  allowed: boolean;
  reason?: GuardRefusalReason;
  budgetState: 'none' | 'ok' | 'warn' | 'paused';
  /** spent/monthly × 100, rounded; only when a budget is configured. */
  budgetPct?: number;
  /** System-prompt fragment to inject when budgetState === 'warn'. */
  warningInstruction?: string;
  /** Running count behind which a concurrency-refused run queues. */
  queueDepth?: number;
  /** Fact echoes so refusal handlers can report exact numbers. */
  monthSpentCents?: number;
  taskRunsLastHour?: number;
}

const TASK_CONTEXTS: ReadonlySet<GuardContext> = new Set([
  'task_run',
  'external_enqueue',
  'external_claim',
]);

const BREAKER_CONTEXTS: ReadonlySet<GuardContext> = new Set([
  'task_run',
  'external_enqueue',
]);

function budgetWarningInstruction(
  pct: number,
  spentCents: number,
  monthlyCents: number,
): string {
  const spent = (spentCents / 100).toFixed(2);
  const monthly = (monthlyCents / 100).toFixed(2);
  return (
    `Budget notice: you have used ${pct}% (${spent} of ${monthly}) of your ` +
    'monthly budget. Be economical: prefer short responses, avoid redundant ' +
    'tool calls, and do not delegate unless necessary.'
  );
}

export function evaluateGuardrails(
  context: GuardContext,
  facts: GuardFacts,
): GuardVerdict {
  // --- Budget (all contexts) ---
  let budgetState: GuardVerdict['budgetState'] = 'none';
  let budgetPct: number | undefined;
  let warningInstruction: string | undefined;
  if (facts.budget) {
    const warnPct = facts.budget.warnPct ?? BUDGET_WARN_PCT_DEFAULT;
    const pausePct = facts.budget.pausePct ?? BUDGET_PAUSE_PCT_DEFAULT;
    budgetPct = Math.round(
      (facts.monthSpentCents / facts.budget.monthlyCents) * 100,
    );
    const spentRatioPct =
      (facts.monthSpentCents / facts.budget.monthlyCents) * 100;
    if (spentRatioPct >= pausePct) {
      return {
        allowed: false,
        reason: 'budget_paused',
        budgetState: 'paused',
        budgetPct,
        monthSpentCents: facts.monthSpentCents,
      };
    }
    if (spentRatioPct >= warnPct) {
      budgetState = 'warn';
      warningInstruction = budgetWarningInstruction(
        budgetPct,
        facts.monthSpentCents,
        facts.budget.monthlyCents,
      );
    } else {
      budgetState = 'ok';
    }
  }

  // --- Per-task circuit breaker ---
  if (BREAKER_CONTEXTS.has(context)) {
    if (facts.taskPausedAt !== undefined) {
      return {
        allowed: false,
        reason: 'task_circuit_breaker',
        budgetState,
        budgetPct,
        monthSpentCents: facts.budget ? facts.monthSpentCents : undefined,
        taskRunsLastHour: facts.taskRunsLastHour,
      };
    }
    if (
      facts.taskRunsLastHour !== undefined &&
      facts.taskRunsLastHour >= facts.taskCircuitCap
    ) {
      return {
        allowed: false,
        reason: 'task_circuit_breaker',
        budgetState,
        budgetPct,
        monthSpentCents: facts.budget ? facts.monthSpentCents : undefined,
        taskRunsLastHour: facts.taskRunsLastHour,
      };
    }
  }

  // --- Concurrency (task contexts only) ---
  if (TASK_CONTEXTS.has(context)) {
    if (facts.agentCap !== undefined && facts.agentRunning >= facts.agentCap) {
      return {
        allowed: false,
        reason: 'agent_concurrency',
        budgetState,
        budgetPct,
        queueDepth: facts.agentRunning,
      };
    }
    if (facts.orgRunning >= facts.orgCap) {
      return {
        allowed: false,
        reason: 'org_concurrency',
        budgetState,
        budgetPct,
        queueDepth: facts.orgRunning,
      };
    }
  }

  return {
    allowed: true,
    budgetState,
    budgetPct,
    warningInstruction,
    monthSpentCents: facts.budget ? facts.monthSpentCents : undefined,
    taskRunsLastHour: facts.taskRunsLastHour,
  };
}
