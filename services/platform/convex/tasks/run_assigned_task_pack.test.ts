import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { workflowJsonSchema } from '../../lib/shared/schemas/workflows';
import type { WorkflowStep } from '../../lib/shared/schemas/workflows';

/**
 * Choreography invariants for the run-assigned-task pack (#2604).
 *
 * The task must NEVER move to In progress before run admission: the ack lives
 * inside `runAgentOnTask` on the admitted side of the gate (see
 * `agents/run_agent_on_task.ts`), so a refused run (agent disabled / not
 * installed, guardrails, automation off) leaves the task status untouched
 * instead of flashing To do → In progress → To do. These tests pin the JSON
 * shape that guarantees it:
 *
 *  1. no `update_status` step is reachable before the `run_on_task` step;
 *  2. the refused branch (run failed WITHOUT an admitted run row) never
 *     touches the task status;
 *  3. the admitted-failure branch still rolls back (the run was acked).
 */

const PACK_PATH = fileURLToPath(
  new URL(
    '../../../../builtin-configs/automations/projects/tasks/run-assigned/automation.json',
    import.meta.url,
  ),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Narrow an unknown config field to a string ('' when it is not one). */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function loadPackSteps(): WorkflowStep[] {
  const manifest = JSON.parse(readFileSync(PACK_PATH, 'utf-8')) as {
    workflow?: unknown;
  };
  const parsed = workflowJsonSchema.safeParse(manifest.workflow);
  if (!parsed.success) {
    throw new Error(
      `run-assigned-task inline workflow fails workflowJsonSchema: ${parsed.error}`,
    );
  }
  return parsed.data.steps;
}

const steps = new Map<string, WorkflowStep>(
  loadPackSteps().map((step) => [step.stepSlug, step]),
);

function actionParams(step: WorkflowStep): Record<string, unknown> {
  return isRecord(step.config.parameters) ? step.config.parameters : {};
}

function operationOf(step: WorkflowStep): string | undefined {
  const operation = actionParams(step).operation;
  return typeof operation === 'string' ? operation : undefined;
}

function expressionOf(step: WorkflowStep): string {
  return asString(step.config.expression);
}

function statusOf(step: WorkflowStep): string | undefined {
  const status = actionParams(step).status;
  return typeof status === 'string' ? status : undefined;
}

/** All steps reachable from `from`, optionally stopping AT (not past) a step. */
function reachable(from: string, stopAt?: (step: WorkflowStep) => boolean) {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const slug = queue.shift();
    if (slug === undefined || seen.has(slug)) continue;
    const step = steps.get(slug);
    if (!step) continue;
    seen.add(slug);
    if (stopAt?.(step)) continue;
    queue.push(...Object.values(step.nextSteps));
  }
  return [...seen].map((slug) => {
    const step = steps.get(slug);
    if (!step) throw new Error(`unknown step ${slug}`);
    return step;
  });
}

describe('run-assigned-task choreography', () => {
  it('never updates the task status before the agent run (admission owns the ack)', () => {
    const beforeRun = reachable(
      'start',
      (step) => operationOf(step) === 'run_on_task',
    );
    expect(beforeRun.some((step) => operationOf(step) === 'run_on_task')).toBe(
      true,
    );
    expect(
      beforeRun.filter((step) => operationOf(step) === 'update_status'),
    ).toEqual([]);
  });

  it('keeps the refused branch (no admitted run row) away from any status change', () => {
    const admittedGate = [...steps.values()].find(
      (step) =>
        step.stepType === 'condition' && expressionOf(step).includes('runId'),
    );
    expect(admittedGate).toBeDefined();
    const refusedBranch = reachable(admittedGate?.nextSteps.false ?? '');
    expect(
      refusedBranch.filter((step) => operationOf(step) === 'update_status'),
    ).toEqual([]);
    // The refusal still explains itself on the task.
    expect(refusedBranch.some((step) => operationOf(step) === 'comment')).toBe(
      true,
    );
  });

  it('still rolls back an admitted-then-failed run (the run was acked In progress)', () => {
    const admittedGate = [...steps.values()].find(
      (step) =>
        step.stepType === 'condition' && expressionOf(step).includes('runId'),
    );
    const admittedBranch = reachable(admittedGate?.nextSteps.true ?? '');
    expect(
      admittedBranch.some(
        (step) =>
          operationOf(step) === 'update_status' && statusOf(step) === 'todo',
      ),
    ).toBe(true);
  });
});
