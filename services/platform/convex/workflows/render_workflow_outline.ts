/**
 * Deterministic markdown outline of a workflow's step graph (W5b).
 *
 * Walks steps via `nextSteps` starting from the entry step (`start`/`trigger`),
 * so the outline reads in execution order rather than file/array order.
 * Every slug, JEXL expression, `{{template}}`, and prompt string is emitted
 * VERBATIM (raw JSON, no summarizing) — this is the faithful source material
 * `specification_actions.ts::previewSpecificationFromGraph` hands to the LLM
 * "polish" pass, so nothing the polish pass reproduces can drift from the
 * real config. Pure — no Convex ctx, no I/O.
 */

import type {
  WorkflowJsonConfig,
  WorkflowStep,
} from '../../lib/shared/schemas/workflows';

/**
 * Order steps by walking `nextSteps` from the entry step (first `start` or
 * `trigger` step, file order otherwise). Anything unreachable from the entry
 * step (orphaned branches, disconnected fragments) is still appended — in
 * file order — so a broken graph never silently loses a step.
 */
function orderStepsForOutline(steps: WorkflowStep[]): WorkflowStep[] {
  const bySlug = new Map(steps.map((step) => [step.stepSlug, step]));
  const visited = new Set<string>();
  const ordered: WorkflowStep[] = [];

  const visit = (slug: string | undefined) => {
    if (!slug || visited.has(slug)) return;
    const step = bySlug.get(slug);
    if (!step) return;
    visited.add(slug);
    ordered.push(step);
    for (const next of Object.values(step.nextSteps)) {
      visit(next);
    }
  };

  const entry = steps.find(
    (step) => step.stepType === 'start' || step.stepType === 'trigger',
  );
  visit(entry?.stepSlug);
  for (const step of steps) {
    visit(step.stepSlug);
  }

  return ordered;
}

export function renderWorkflowOutline(config: WorkflowJsonConfig): string {
  const lines: string[] = [`# ${config.name}`];
  if (config.description) {
    lines.push('', config.description);
  }

  const ordered = orderStepsForOutline(config.steps);

  if (ordered.length === 0) {
    lines.push('', '(This workflow has no steps yet.)');
  }

  for (const step of ordered) {
    lines.push('', `## ${step.stepSlug} (${step.stepType})`);
    lines.push(`Name: ${step.name}`);
    if (step.description) {
      lines.push(`Description: ${step.description}`);
    }
    lines.push(
      'Config:',
      '```json',
      JSON.stringify(step.config, null, 2),
      '```',
    );
    lines.push(
      'Next steps:',
      '```json',
      JSON.stringify(step.nextSteps, null, 2),
      '```',
    );
  }

  return lines.join('\n');
}
