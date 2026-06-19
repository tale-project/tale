/**
 * The operator projection hook: join the workflow DEFINITION (steps +
 * `ui`/`role` annotations, static during a run) with the LIVE execution state
 * (reactive) on `stepSlug`. The engine never sees the annotations; this is the
 * single place the friendly view is assembled from (definition × runtime).
 */
import { useMemo } from 'react';

import { useReadWorkflow } from '@/app/features/automations/hooks/file-queries';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { ExecutionNodeState } from '@/convex/workflows/executions/get_execution_step_statuses';
import {
  RENDER_KIND_META,
  type RenderKind,
  isRenderKind,
} from '@/lib/shared/platform/render_kinds';
import { isRecord } from '@/lib/utils/type-utils';

import { derivePartState } from '../lib/derive-part-state';
import type {
  OperatorProjection,
  StepProjection,
  StepUiAnnotation,
} from '../types';

interface DefinitionStep {
  stepSlug: string;
  name: string;
  stepType: string;
  ui?: StepUiAnnotation;
  role?: string;
}

function parseParams(
  raw: unknown,
): NonNullable<StepUiAnnotation['params']> | undefined {
  if (!isRecord(raw)) return undefined;
  const params: NonNullable<StepUiAnnotation['params']> = {};
  if (typeof raw.display === 'string') params.display = raw.display;
  if (typeof raw.layout === 'string') params.layout = raw.layout;
  if (typeof raw.entryKind === 'string') params.entryKind = raw.entryKind;
  if (typeof raw.mode === 'string') params.mode = raw.mode;
  if (typeof raw.cardinality === 'string') params.cardinality = raw.cardinality;
  return params;
}

function parseUi(raw: unknown): StepUiAnnotation | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.render !== 'string') return undefined;
  const ui: StepUiAnnotation = { render: raw.render };
  if (typeof raw.stage === 'string') ui.stage = raw.stage;
  if (typeof raw.labelKey === 'string') ui.labelKey = raw.labelKey;
  const params = parseParams(raw.params);
  if (params !== undefined) ui.params = params;
  return ui;
}

/** Defensively read the steps array out of the (v.any) readWorkflow payload. */
function parseDefinitionSteps(config: unknown): DefinitionStep[] {
  if (!isRecord(config) || !Array.isArray(config.steps)) return [];
  const out: DefinitionStep[] = [];
  for (const raw of config.steps) {
    if (!isRecord(raw)) continue;
    if (typeof raw.stepSlug !== 'string') continue;
    const step: DefinitionStep = {
      stepSlug: raw.stepSlug,
      name: typeof raw.name === 'string' ? raw.name : raw.stepSlug,
      stepType: typeof raw.stepType === 'string' ? raw.stepType : 'action',
    };
    const ui = parseUi(raw.ui);
    if (ui !== undefined) step.ui = ui;
    if (typeof raw.role === 'string') step.role = raw.role;
    out.push(step);
  }
  return out;
}

function resolveRenderKind(ui: StepUiAnnotation | undefined): RenderKind {
  // Graceful degradation: an unannotated or unknown render → the generic
  // `status` panel (the part envelope still shows lifecycle), never a throw.
  if (ui && isRenderKind(ui.render)) return ui.render;
  return 'status';
}

function parseOutput(node: ExecutionNodeState | undefined): unknown {
  if (!node?.outputPreview || node.outputTruncated) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(node.outputPreview);
  } catch {
    return undefined;
  }
  // A run-detail node output is the engine's StepOutput envelope, whose shape is
  // EXACTLY { type, data, meta? }; unwrap to the inner payload so the render-kind
  // panels read the REAL fields (a sandbox step's `summary`, a transform's
  // `rowsIn`, …) instead of finding them nested under `.data` and bailing to the
  // raw-JSON view. Match the canonical shape PRECISELY (only type/data/meta keys)
  // so a payload that merely happens to carry a `type`+`data` pair isn't unwrapped;
  // map a null inner payload to undefined (a step that produced no output).
  if (
    isRecord(parsed) &&
    typeof parsed.type === 'string' &&
    'data' in parsed &&
    Object.keys(parsed).every(
      (k) => k === 'type' || k === 'data' || k === 'meta',
    )
  ) {
    return parsed.data ?? undefined;
  }
  return parsed;
}

function projectStep(
  step: DefinitionStep,
  node: ExecutionNodeState | undefined,
  liveProgress?: string,
): StepProjection {
  const render = resolveRenderKind(step.ui);
  const interaction = RENDER_KIND_META[render].interaction;
  const projection: StepProjection = {
    stepSlug: step.stepSlug,
    name: step.name,
    stepType: step.stepType,
    render,
    partState: derivePartState(node, interaction),
  };
  if (step.ui?.stage !== undefined) projection.stage = step.ui.stage;
  if (step.ui?.labelKey !== undefined) projection.labelKey = step.ui.labelKey;
  if (step.ui?.params !== undefined) projection.params = step.ui.params;
  if (step.role !== undefined) projection.role = step.role;
  if (node !== undefined) projection.node = node;
  const output = parseOutput(node);
  // A RUNNING sandbox step has no `summary` yet (its result only lands at the
  // segment seam), so its envelope would fall back to raw JSON. Surface the
  // agent's LIVE op progress as the stream summary so the operator watches it
  // work; once the step finishes, `output.summary` (persisted) takes over.
  if (liveProgress !== undefined && liveProgress.trim() !== '') {
    projection.output = {
      ...(isRecord(output) ? output : {}),
      summary: liveProgress,
    };
  } else if (output !== undefined) {
    projection.output = output;
  }
  return projection;
}

export interface UseExecutionProjectionResult {
  projection: OperatorProjection | null;
  isLoading: boolean;
  error: Error | null;
}

export function useExecutionProjection(args: {
  organizationId: string;
  executionId: string;
}): UseExecutionProjectionResult {
  const statuses = useConvexQuery(
    api.workflow_executions.queries.getExecutionStepStatuses,
    { executionId: args.executionId },
  );

  const workflowSlug = statuses.data?.execution.workflowSlug;
  const definition = useReadWorkflow(args.organizationId, workflowSlug);

  // The running `sandbox` step (if any) whose live agent op we subscribe to —
  // its progress feeds the stream panel so it shows live work, not raw JSON.
  const runningSandboxStepSlug = useMemo<string | null>(() => {
    const live = statuses.data;
    if (!live || live.execution.status !== 'running') return null;
    const slug = live.execution.currentStepSlug;
    if (slug === undefined) return null;
    if (live.nodes[slug]?.status !== 'running') return null;
    const def = definition.data;
    const defStep = parseDefinitionSteps(
      def && def.ok ? def.config : undefined,
    ).find((s) => s.stepSlug === slug);
    const stepType = defStep?.stepType ?? live.nodes[slug]?.stepType;
    return stepType === 'sandbox' ? slug : null;
  }, [statuses.data, definition.data]);

  // Called UNCONDITIONALLY (Rules of Hooks): `'skip'` is Convex's no-subscription
  // sentinel passed as the ARGS, not a React conditional around the hook — so it
  // stays valid when runningSandboxStepSlug flips between null and a slug.
  const liveOp = useConvexQuery(
    api.sandbox.session_queries_public.getWorkflowSandboxOp,
    runningSandboxStepSlug !== null
      ? {
          organizationId: args.organizationId,
          executionId: args.executionId,
          stepSlug: runningSandboxStepSlug,
        }
      : 'skip',
  );
  const liveProgress =
    runningSandboxStepSlug !== null ? liveOp.data?.progressText : undefined;

  const projection = useMemo<OperatorProjection | null>(() => {
    const live = statuses.data;
    if (!live) return null;

    const def = definition.data;
    const config = def && def.ok ? def.config : undefined;
    const defSteps = parseDefinitionSteps(config);

    // The definition is the spine (every step shows, even unstarted). Until it
    // loads, fall back to the live node keys so something renders.
    const sourceSteps: DefinitionStep[] =
      defSteps.length > 0
        ? defSteps
        : Object.keys(live.nodes).map((stepSlug) => ({
            stepSlug,
            name: live.nodes[stepSlug]?.stepName ?? stepSlug,
            stepType: live.nodes[stepSlug]?.stepType ?? 'action',
          }));

    const steps = sourceSteps.map((step) =>
      projectStep(
        step,
        live.nodes[step.stepSlug],
        step.stepSlug === runningSandboxStepSlug ? liveProgress : undefined,
      ),
    );

    const stages: string[] = [];
    for (const step of steps) {
      if (step.stage && !stages.includes(step.stage)) stages.push(step.stage);
    }

    const workflowName =
      config && isRecord(config) && typeof config.name === 'string'
        ? config.name
        : undefined;

    const result: OperatorProjection = {
      status: live.execution.status,
      startedAt: live.execution.startedAt,
      stages,
      steps,
    };
    if (workflowName !== undefined) result.workflowName = workflowName;
    if (live.execution.error !== undefined) {
      result.error = live.execution.error;
    }
    if (live.execution.completedAt !== undefined) {
      result.completedAt = live.execution.completedAt;
    }
    if (live.execution.currentStepSlug !== undefined) {
      result.currentStepSlug = live.execution.currentStepSlug;
    }
    return result;
  }, [statuses.data, definition.data, runningSandboxStepSlug, liveProgress]);

  return {
    projection,
    isLoading: statuses.isLoading || definition.isLoading,
    error: statuses.error ?? definition.error ?? null,
  };
}
