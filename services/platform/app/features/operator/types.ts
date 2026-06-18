/**
 * Projection types for the metadata-driven operator view. A running workflow is
 * projected by joining its static DEFINITION (steps + `ui`/`role` annotations)
 * with the live runtime node-state on `stepSlug` — the engine stays headless;
 * the friendly view is pure data + a generic renderer.
 */
import type { ExecutionNodeState } from '@/convex/workflows/executions/get_execution_step_statuses';
import type { PartState } from '@/lib/shared/platform/part_state';
import type { RenderKind } from '@/lib/shared/platform/render_kinds';

/** The `ui` annotation a step carries in its workflow-definition row. */
export interface StepUiAnnotation {
  stage?: string;
  render: string;
  labelKey?: string;
  params?: {
    display?: string;
    layout?: string;
    entryKind?: string;
    mode?: string;
    cardinality?: string;
    fields?: { key: string; labelKey: string; type: string }[];
  };
}

/**
 * One step projected for the operator view — the static definition joined with
 * the live runtime node-state.
 */
export interface StepProjection {
  stepSlug: string;
  /** Definition name — the always-present title; `labelKey` localizes over it. */
  name: string;
  stepType: string;
  /** Resolved render kind. Falls back to `status` when unannotated/unknown so a
   * missing annotation degrades gracefully rather than dropping the step. */
  render: RenderKind;
  stage?: string;
  /** Tier-2 (pack-authored) localization key for the title, when present. */
  labelKey?: string;
  params?: StepUiAnnotation['params'];
  /** Advisory role annotation (resolved elsewhere; surfaced for display). */
  role?: string;
  /** The orthogonal lifecycle/streaming state the part envelope renders. */
  partState: PartState;
  /** Live node-state — absent until the step has executed. */
  node?: ExecutionNodeState;
  /** Parsed `node.outputPreview` JSON, when present and parseable. */
  output?: unknown;
}

/** The whole execution projected for the operator shell. */
export interface OperatorProjection {
  status: string;
  workflowName?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
  /** Distinct stages in definition order — drives the stage-timeline header. */
  stages: string[];
  currentStepSlug?: string;
  steps: StepProjection[];
}
