/**
 * Map a step's live runtime node-state onto the orthogonal lifecycle/streaming
 * `state` axis (see lib/shared/platform/part_state). Modeled once here so every
 * render-kind panel shows loading / running / error / waiting / empty uniformly
 * — the would-be error/empty/wait render-kinds need no code.
 */
import type { ExecutionNodeState } from '@/convex/workflows/executions/get_execution_step_statuses';
import type { PartState } from '@/lib/shared/platform/part_state';
import type { RenderInteraction } from '@/lib/shared/platform/render_kinds';

export function derivePartState(
  node: ExecutionNodeState | undefined,
  interaction: RenderInteraction,
  /** True when this is the step the run is ON right now (the current step). A
   * not-yet-run step that is the current one is `loading` (about to run); one
   * still further down the plan is `upcoming` (a quiet preview, no skeleton). */
  reached = true,
  /** True when the run's progress has already moved PAST this un-run step (a
   * conditional lane the gate routed around) — shown as `skipped`. `reached`
   * wins: a loop that routes back onto the lane makes it the current step
   * (imminent, loading) before its node exists. */
  bypassed = false,
): PartState {
  // No journal entry yet → scheduled. The current step is loading; a lane the
  // run moved past is skipped; later steps are merely upcoming, so a 9-step
  // run on step 3 isn't a wall of skeletons.
  if (!node) return reached ? 'loading' : bypassed ? 'skipped' : 'upcoming';

  switch (node.status) {
    case 'running':
      return 'running';
    case 'queued':
      // Park-on-capacity: queued behind the org's sandbox concurrency cap. Its
      // own affordance ("Queued for capacity") replaces the body — never the
      // raw `{status:'awaiting_capacity'}` envelope.
      return 'queued_capacity';
    case 'waiting':
      // An actionable kind (review/reconciliation) waits on a HUMAN; anything
      // else is blocked on an external event (sandbox / awaited trigger).
      return interaction === 'actionable'
        ? 'waiting_human'
        : 'waiting_external';
    case 'paused':
      // Debug-gate pause — the node is parked right before running.
      return 'waiting_external';
    case 'failed':
    case 'canceled':
      return 'output_error';
    case 'success':
      return node.outputPreview || node.outputUnavailable
        ? 'output_available'
        : 'empty';
    default:
      return 'loading';
  }
}
