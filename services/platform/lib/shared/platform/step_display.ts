/**
 * Which workflow steps the user-facing surfaces SHOW, and how. The friendly
 * process map (apps `WorkflowMap`) and the live run view (operator) must agree on
 * this, so the rule lives once here — both features already import this `shared`
 * folder (render_kinds / part_state), so neither reaches into the other.
 *
 * A workflow's wire form carries plumbing the user does not care to watch —
 * structural endpoints, routing `condition`s, and bare status-bump `action`s. The
 * principle: an author OPTS A STEP IN by giving it a `ui` annotation; everything
 * unannotated that is pure plumbing collapses out, so the process reads as its
 * meaningful spine rather than a wall of identical "Status" tiles. Decision
 * points (the merge judge) stay visible but DE-EMPHASIZED via the `gate`
 * treatment, chosen explicitly with `ui.params.display: 'gate'` or implied by an
 * unannotated `llm` step.
 */

export type StepTreatment = 'hidden' | 'gate' | 'normal';

/** Step types that are pure structure, never shown. */
const STRUCTURAL_TYPES = new Set(['start', 'trigger', 'output']);

interface StepDisplayInput {
  stepType: string;
  /** Whether the step carries a `ui` annotation (the opt-in to be shown). */
  hasUi: boolean;
  /** The step's `ui.params.display`, when present (e.g. `'gate'`). */
  display?: string;
}

/**
 * How a step renders in the friendly surfaces: `hidden` (collapsed plumbing),
 * `gate` (a visible-but-quiet decision checkpoint), or `normal`.
 */
export function stepTreatment({
  stepType,
  hasUi,
  display,
}: StepDisplayInput): StepTreatment {
  if (STRUCTURAL_TYPES.has(stepType)) return 'hidden';
  if (display === 'gate') return 'gate';
  if (hasUi) return 'normal';
  // Unannotated: routing conditions and bare status-bump actions are plumbing;
  // an LLM decision step stays as a quiet gate; anything else (e.g. a sandbox
  // agent run) is core work and shows normally.
  if (stepType === 'condition' || stepType === 'action') return 'hidden';
  if (stepType === 'llm') return 'gate';
  return 'normal';
}

/** True when the step should appear at all (not pure plumbing). */
export function isStepVisible(input: StepDisplayInput): boolean {
  return stepTreatment(input) !== 'hidden';
}
