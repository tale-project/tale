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
  /** How the step renders in the friendly view: `gate` = a quiet decision
   * checkpoint (the LLM judge); `normal` otherwise. Hidden steps are filtered
   * out before projection, so this never carries `'hidden'`. */
  treatment?: 'normal' | 'gate';
  /** Live agent UI-part transcript for a RUNNING sandbox step (the run-view
   * feed), read from the workflow-run op. Absent once the step finishes. */
  liveParts?: unknown[];
  /** Openable output files (name + resolved url) harvested from the step, e.g.
   * the mandated `summary.md`. Resolved at the projection boundary. */
  files?: { name: string; url: string }[];
  /** Live node-state — absent until the step has executed. */
  node?: ExecutionNodeState;
  /** Parsed `node.outputPreview` JSON, when present and parseable. */
  output?: unknown;
}

/**
 * The reusable unit the render-kind components + part envelope consume — a
 * single panel to render, produced by the run-detail view adapting each workflow
 * step (via `stepToPart`). Decoupling the render-kinds from "a workflow step"
 * keeps the panel components reusable beyond run details.
 */
export interface RenderPart {
  render: RenderKind;
  partState: PartState;
  /** Display title (already localized or a plain name). */
  title: string;
  /** Tier-2 pack key to localize the title over (optional). */
  labelKey?: string;
  stage?: string;
  role?: string;
  /** `gate` renders a quiet decision checkpoint; `normal` otherwise. */
  treatment?: 'normal' | 'gate';
  params?: StepUiAnnotation['params'];
  /** The payload the render-kind component renders. */
  data: unknown;
  /** Live agent UI-part transcript for a RUNNING sandbox step — the rich live
   * feed the `stream` panel renders in place of the flat summary. */
  liveParts?: unknown[];
  /** Openable output files (name + resolved url), e.g. the harvested
   * `summary.md` — surfaced by the `stream` panel. */
  files?: { name: string; url: string }[];
  /** Error text surfaced by the envelope in the output_error state. */
  error?: string;
  /** Run-detail-only node timing (the status/transform panels show it). */
  meta?: { attempts?: number; startedAt?: number; completedAt?: number };
  /**
   * Master-detail selection (the LIST part of a `split` view): clicking a row
   * calls `onSelect(row)`; the row whose `selectionKey` value equals
   * `selectedId` is highlighted.
   */
  onSelect?: (item: Record<string, unknown>) => void;
  selectionKey?: string;
  selectedId?: string;
}

/** Adapt a projected workflow step into the generic RenderPart. */
export function stepToPart(step: StepProjection): RenderPart {
  const part: RenderPart = {
    render: step.render,
    partState: step.partState,
    title: step.name,
    data: step.output,
  };
  if (step.labelKey !== undefined) part.labelKey = step.labelKey;
  if (step.stage !== undefined) part.stage = step.stage;
  if (step.role !== undefined) part.role = step.role;
  if (step.treatment !== undefined) part.treatment = step.treatment;
  if (step.params !== undefined) part.params = step.params;
  if (step.liveParts !== undefined) part.liveParts = step.liveParts;
  if (step.files !== undefined) part.files = step.files;
  if (step.node?.error !== undefined) part.error = step.node.error;
  if (step.node) {
    part.meta = {
      attempts: step.node.attempts,
      ...(step.node.startedAt !== undefined && {
        startedAt: step.node.startedAt,
      }),
      ...(step.node.completedAt !== undefined && {
        completedAt: step.node.completedAt,
      }),
    };
  }
  return part;
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
