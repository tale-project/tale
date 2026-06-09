/**
 * Orchestration execution engine.
 *
 * Runs a validated plan as a dependency DAG: independent steps in a level run
 * concurrently, levels run sequentially, and same-agent steps in a level
 * serialize (they'd collide on one sub-thread). Budget is enforced per level —
 * when the remaining wall-clock falls below the floor, later levels are
 * skipped and partial results flow to synthesis. A failing step does NOT abort;
 * dependents still run and receive a failure note in their context.
 *
 * Pure orchestration over an injected `runStep`, so it is fully unit-testable
 * without the Convex runtime. `plan.ts` provides the real `runStep`
 * (wrapping `runDelegateStep`).
 */

import {
  buildStepPrompt,
  layerPlan,
  MAX_PARALLEL_WIDTH,
  type PlanStep,
  type StepResult,
} from './plan_helpers';

/** Outcome of running one step's delegate. `error` set ⇒ the step failed. */
export interface StepRunResult {
  text: string;
  error?: string;
}

export interface ExecutePlanArgs {
  steps: PlanStep[];
  /** Run one delegate step. Throwing is treated as a step error (never aborts the run). */
  runStep: (slug: string, prompt: string) => Promise<StepRunResult>;
  /** Aggregate wall-clock deadline (epoch ms). When unset, no time limit. */
  deadlineMs?: number;
  /** Minimum remaining ms required to start a new level (graceful degradation). */
  minLevelBudgetMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export interface ExecutePlanResult {
  steps: StepResult[];
  /** True when one or more levels were skipped due to budget exhaustion. */
  deadlineHit: boolean;
}

const DEFAULT_MIN_LEVEL_BUDGET_MS = 30_000;

export async function executePlan(
  args: ExecutePlanArgs,
): Promise<ExecutePlanResult> {
  const now = args.now ?? (() => Date.now());
  const minLevelBudget = args.minLevelBudgetMs ?? DEFAULT_MIN_LEVEL_BUDGET_MS;
  const levels = layerPlan(args.steps);
  const results = new Map<string, StepResult>();
  let deadlineHit = false;

  const budgetExhausted = (): boolean =>
    args.deadlineMs !== undefined && args.deadlineMs - now() < minLevelBudget;

  const identity = (
    step: PlanStep,
  ): Pick<StepResult, 'id' | 'agentSlug' | 'subTask'> => ({
    id: step.id,
    agentSlug: step.agentSlug,
    subTask: step.subTask,
  });

  const skip = (step: PlanStep): StepResult => ({
    ...identity(step),
    status: 'skipped',
    response: '',
    error: 'skipped: orchestration budget exhausted',
  });

  for (const level of levels) {
    if (budgetExhausted()) {
      deadlineHit = true;
      for (const step of level) results.set(step.id, skip(step));
      continue;
    }

    // Group by slug so two steps targeting the SAME agent (same sub-thread)
    // run sequentially; distinct agents run in parallel.
    const groups = new Map<string, PlanStep[]>();
    for (const step of level) {
      const existing = groups.get(step.agentSlug);
      if (existing) existing.push(step);
      else groups.set(step.agentSlug, [step]);
    }

    // Run distinct-agent groups concurrently, but cap the in-flight width at
    // MAX_PARALLEL_WIDTH so a wide level can't fan out unbounded sub-agent load
    // (provider rate limits, action concurrency). Steps within a group already
    // serialize on their shared sub-thread.
    const groupList = [...groups.values()];
    const runGroup = async (group: PlanStep[]): Promise<StepResult[]> => {
      const out: StepResult[] = [];
      for (const step of group) out.push(await runOne(step));
      return out;
    };
    for (let i = 0; i < groupList.length; i += MAX_PARALLEL_WIDTH) {
      const batch = groupList.slice(i, i + MAX_PARALLEL_WIDTH);
      const batchResults = await Promise.all(batch.map(runGroup));
      for (const group of batchResults) {
        for (const r of group) results.set(r.id, r);
      }
    }
  }

  // Preserve original step order in the returned list.
  return {
    steps: args.steps
      .map((s) => results.get(s.id))
      .filter((r): r is StepResult => r !== undefined),
    deadlineHit,
  };

  async function runOne(step: PlanStep): Promise<StepResult> {
    const deps = step.dependsOn
      .map((id) => results.get(id))
      .filter((r): r is StepResult => r !== undefined);
    const prompt = buildStepPrompt(step.subTask, deps);
    const errorResult = (error: string): StepResult => ({
      ...identity(step),
      status: 'error',
      response: '',
      error,
    });
    try {
      const res = await args.runStep(step.agentSlug, prompt);
      if (res.error) return errorResult(res.error);
      return { ...identity(step), status: 'ok', response: res.text };
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  }
}
