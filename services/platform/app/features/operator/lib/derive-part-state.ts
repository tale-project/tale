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
): PartState {
  // No journal entry yet → the step is scheduled but hasn't run.
  if (!node) return 'loading';

  switch (node.status) {
    case 'running':
      return 'running';
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
