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

/** Agent-action operations that RUN an agent on a subject — live core work
 * with a durable sandbox transcript the user watches, unlike the roster and
 * bookkeeping operations (budget checks, reassignment, requeues) that stay
 * plumbing. Without this carve-out an unannotated `respond` step (the pack
 * mention/assignment reaction) collapses out and the run view shows nothing
 * while the agent works. */
const AGENT_RUN_OPERATIONS = new Set(['run_on_task', 'decompose_task']);

interface StepDisplayInput {
  stepType: string;
  /** Whether the step carries a `ui` annotation (the opt-in to be shown). */
  hasUi: boolean;
  /** The step's `ui.params.display`, when present (e.g. `'gate'`). */
  display?: string;
  /** For `action` steps: the action's `config.type` (e.g. `'agent'`). */
  actionType?: string;
  /** For `action` steps: the action's `parameters.operation`. */
  actionOperation?: string;
}

/** An `action` step that RUNS an agent (vs agent bookkeeping) — shown as core
 * work by `stepTreatment` and rendered as a `stream` transcript by the run
 * view even without a `ui` annotation. */
export function isAgentRunAction(input: {
  stepType: string;
  actionType?: string;
  actionOperation?: string;
}): boolean {
  return (
    input.stepType === 'action' &&
    input.actionType === 'agent' &&
    AGENT_RUN_OPERATIONS.has(input.actionOperation ?? '')
  );
}

/**
 * How a step renders in the friendly surfaces: `hidden` (collapsed plumbing),
 * `gate` (a visible-but-quiet decision checkpoint), or `normal`.
 */
export function stepTreatment({
  stepType,
  hasUi,
  display,
  actionType,
  actionOperation,
}: StepDisplayInput): StepTreatment {
  if (STRUCTURAL_TYPES.has(stepType)) return 'hidden';
  if (display === 'gate') return 'gate';
  if (hasUi) return 'normal';
  // Unannotated: routing conditions and bare status-bump actions are plumbing;
  // an LLM decision step stays as a quiet gate; anything else (a harness
  // turn, an agent-running action) is core work and shows normally.
  if (stepType === 'condition') return 'hidden';
  if (stepType === 'action') {
    return isAgentRunAction({ stepType, actionType, actionOperation })
      ? 'normal'
      : 'hidden';
  }
  if (stepType === 'llm') return 'gate';
  return 'normal';
}

/** True when the step should appear at all (not pure plumbing). */
export function isStepVisible(input: StepDisplayInput): boolean {
  return stepTreatment(input) !== 'hidden';
}

/**
 * Indexes of un-run lanes the run has already moved PAST. A conditional lane
 * the gate skipped (e.g. a plan review the advisor never flagged) would
 * otherwise sit at "Up next" forever while LATER steps run — a lie about
 * what's coming. Callers MARK these lanes as `skipped` rather than hiding
 * them: the operator should see the review was bypassed, not wonder where it
 * went. A lane is "passed" when it has no node but some later-ordered
 * definition step does; the mark clears the moment a loop actually runs it
 * (it then has a node). `lastTouchedIndex` is the max DEFINITION index with a
 * node, computed over ALL steps (hidden plumbing included) so branch progress
 * counts. Returns the bypassed indexes, in original order.
 */
export function bypassedLaneIndexes(
  steps: readonly { hasRun: boolean; defIndex: number }[],
  lastTouchedIndex: number,
): number[] {
  return steps
    .map((_, i) => i)
    .filter((i) => {
      const step = steps[i];
      if (step === undefined) return false;
      return !step.hasRun && step.defIndex <= lastTouchedIndex;
    });
}

export interface SpineLaneInput {
  /** The step's `ui.labelKey` — the grouping key. Absent ⇒ never grouped. */
  labelKey?: string;
  /** Whether the run has touched this step (a live node state exists). */
  hasRun: boolean;
}

/**
 * Collapse mutually-exclusive BRANCH VARIANTS of one concept into a single
 * spine lane. Steps that share a `ui.labelKey` are alternatives of the same
 * user-facing step (a round-0/round-1 review gate, one dream step per judge
 * verdict): rendering each un-run variant as its own "Up next" lane reads as
 * pending work that will never happen. Keep every variant the run actually
 * touched (real history), and — only when none has run yet — the FIRST as the
 * lane's single upcoming placeholder. Steps without a `labelKey` always keep
 * their own lane. Returns the kept indexes, in original order.
 */
export function dedupeSpineLanes(steps: readonly SpineLaneInput[]): number[] {
  const groups = new Map<string, number[]>();
  steps.forEach((step, i) => {
    if (step.labelKey === undefined) return;
    const members = groups.get(step.labelKey) ?? [];
    members.push(i);
    groups.set(step.labelKey, members);
  });
  const dropped = new Set<number>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ran = members.filter((i) => steps[i]?.hasRun);
    const kept = ran.length > 0 ? new Set(ran) : new Set([members[0]]);
    for (const i of members) {
      if (!kept.has(i)) dropped.add(i);
    }
  }
  return steps.map((_, i) => i).filter((i) => !dropped.has(i));
}
