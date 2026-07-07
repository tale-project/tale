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
import type { Id } from '@/convex/_generated/dataModel';
import type { ExecutionNodeState } from '@/convex/workflows/executions/get_execution_step_statuses';
import {
  RENDER_KIND_META,
  type RenderKind,
  isRenderKind,
} from '@/lib/shared/platform/render_kinds';
import {
  dedupeSpineLanes,
  isStepVisible,
  pruneBypassedLanes,
  stepTreatment,
} from '@/lib/shared/platform/step_display';
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
  if (isRecord(raw.verdictLabels)) {
    const verdictLabels: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw.verdictLabels)) {
      if (typeof value === 'string') verdictLabels[key] = value;
    }
    if (Object.keys(verdictLabels).length > 0) {
      params.verdictLabels = verdictLabels;
    }
  }
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

/** The `step_display` predicate input for a definition step. */
function displayInput(step: DefinitionStep): {
  stepType: string;
  hasUi: boolean;
  display?: string;
} {
  return {
    stepType: step.stepType,
    hasUi: step.ui !== undefined,
    ...(step.ui?.params?.display !== undefined && {
      display: step.ui.params.display,
    }),
  };
}

/** Resolve a node's harvested output files to openable {name,url} links. */
function filesForNode(
  node: ExecutionNodeState | undefined,
  urlByStorageId: ReadonlyMap<string, string>,
): { name: string; url: string }[] | undefined {
  const out = parseOutput(node);
  if (!isRecord(out) || !Array.isArray(out.outputFiles)) return undefined;
  const files: { name: string; url: string }[] = [];
  for (const f of out.outputFiles) {
    if (!isRecord(f)) continue;
    if (typeof f.name !== 'string' || typeof f.storageId !== 'string') continue;
    const url = urlByStorageId.get(f.storageId);
    if (url) files.push({ name: f.name, url });
  }
  return files.length > 0 ? files : undefined;
}

function projectStep(
  step: DefinitionStep,
  node: ExecutionNodeState | undefined,
  opts: {
    liveProgress?: string;
    liveParts?: unknown[];
    files?: { name: string; url: string }[];
    /** True only for the step the run is currently on (loading vs upcoming). */
    reached: boolean;
    treatment: 'normal' | 'gate';
  },
): StepProjection {
  const render = resolveRenderKind(step.ui);
  const interaction = RENDER_KIND_META[render].interaction;
  const projection: StepProjection = {
    stepSlug: step.stepSlug,
    name: step.name,
    stepType: step.stepType,
    render,
    treatment: opts.treatment,
    partState: derivePartState(node, interaction, opts.reached),
  };
  if (step.ui?.stage !== undefined) projection.stage = step.ui.stage;
  if (step.ui?.labelKey !== undefined) projection.labelKey = step.ui.labelKey;
  if (step.ui?.params !== undefined) projection.params = step.ui.params;
  if (step.role !== undefined) projection.role = step.role;
  if (node !== undefined) projection.node = node;
  if (opts.liveParts !== undefined && opts.liveParts.length > 0) {
    projection.liveParts = opts.liveParts;
  }
  if (opts.files !== undefined) projection.files = opts.files;
  const output = parseOutput(node);
  // A RUNNING sandbox step has no persisted `summary`/timeline yet (the result
  // only lands at the segment seam). The rich live transcript (`liveParts`) is
  // the primary feed; keep the agent's LIVE op progress text as the stream
  // summary too so there's always something, and once the step finishes the
  // persisted `output.summary` takes over.
  if (opts.liveProgress !== undefined && opts.liveProgress.trim() !== '') {
    projection.output = {
      ...(isRecord(output) ? output : {}),
      summary: opts.liveProgress,
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
  const liveTimeline =
    runningSandboxStepSlug !== null ? liveOp.data?.liveTimeline : undefined;

  // Harvested output-file storage ids across all steps → resolved to openable
  // urls (one batched query) so the stream panel can offer "Open summary.md".
  const outputFileStorageIds = useMemo<string[]>(() => {
    const live = statuses.data;
    if (!live) return [];
    const ids = new Set<string>();
    for (const slug of Object.keys(live.nodes)) {
      const out = parseOutput(live.nodes[slug]);
      if (isRecord(out) && Array.isArray(out.outputFiles)) {
        for (const f of out.outputFiles) {
          if (isRecord(f) && typeof f.storageId === 'string')
            ids.add(f.storageId);
        }
      }
    }
    return [...ids];
  }, [statuses.data]);

  const fileUrls = useConvexQuery(
    api.files.queries.getFileUrls,
    outputFileStorageIds.length > 0
      ? // The ids are `_storage` ids harvested into the step output.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        { fileIds: outputFileStorageIds as Id<'_storage'>[] }
      : 'skip',
  );
  const urlByStorageId = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const r of fileUrls.data ?? []) if (r.url) m.set(r.fileId, r.url);
    return m;
  }, [fileUrls.data]);

  const projection = useMemo<OperatorProjection | null>(() => {
    const live = statuses.data;
    if (!live) return null;

    const def = definition.data;
    const config = def && def.ok ? def.config : undefined;
    const defSteps = parseDefinitionSteps(config);
    const usingDef = defSteps.length > 0;

    // The definition is the spine (every meaningful step shows, even unstarted),
    // with pure plumbing (routing conditions, status-bumps) collapsed out via the
    // shared predicate so map and run view agree. Until it loads, fall back to
    // the live node keys UNFILTERED (transient) so something renders.
    const visibleSteps: DefinitionStep[] = usingDef
      ? defSteps.filter((step) => isStepVisible(displayInput(step)))
      : Object.keys(live.nodes).map((stepSlug) => ({
          stepSlug,
          name: live.nodes[stepSlug]?.stepName ?? stepSlug,
          stepType: live.nodes[stepSlug]?.stepType ?? 'action',
        }));

    // A skipped conditional lane (no node, but a LATER definition step has
    // one) must not sit at "Up next" while the run demonstrably moved past it
    // — prune it; a loop that later runs it gives it a node and it reappears.
    // Progress counts hidden plumbing too, so use the FULL definition order.
    let lastTouchedIndex = -1;
    defSteps.forEach((step, i) => {
      if (live.nodes[step.stepSlug] !== undefined) lastTouchedIndex = i;
    });
    const defIndexBySlug = new Map(defSteps.map((s, i) => [s.stepSlug, i]));
    const reachableIndexes = new Set(
      pruneBypassedLanes(
        visibleSteps.map((step) => ({
          hasRun: live.nodes[step.stepSlug] !== undefined,
          defIndex: defIndexBySlug.get(step.stepSlug) ?? Number.MAX_VALUE,
        })),
        lastTouchedIndex,
      ),
    );
    const reachableSteps = visibleSteps.filter((_, i) =>
      reachableIndexes.has(i),
    );

    // Branch variants of one concept (same `ui.labelKey`) collapse into a
    // single lane: only the variants this run actually touched show, or one
    // upcoming placeholder while none has — never a parade of "Up next" twins.
    const keptIndexes = new Set(
      dedupeSpineLanes(
        reachableSteps.map((step) => ({
          ...(step.ui?.labelKey !== undefined && {
            labelKey: step.ui.labelKey,
          }),
          hasRun: live.nodes[step.stepSlug] !== undefined,
        })),
      ),
    );
    const sourceSteps = reachableSteps.filter((_, i) => keptIndexes.has(i));

    const steps = sourceSteps.map((step) => {
      const node = live.nodes[step.stepSlug];
      const isRunning = step.stepSlug === runningSandboxStepSlug;
      const treatment =
        stepTreatment(displayInput(step)) === 'gate' ? 'gate' : 'normal';
      const files = filesForNode(node, urlByStorageId);
      return projectStep(step, node, {
        reached: step.stepSlug === live.execution.currentStepSlug,
        treatment,
        ...(isRunning && liveProgress !== undefined && { liveProgress }),
        ...(isRunning &&
          liveTimeline !== undefined && { liveParts: liveTimeline }),
        ...(files !== undefined && { files }),
      });
    });

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
  }, [
    statuses.data,
    definition.data,
    runningSandboxStepSlug,
    liveProgress,
    liveTimeline,
    urlByStorageId,
  ]);

  return {
    projection,
    isLoading: statuses.isLoading || definition.isLoading,
    error: statuses.error ?? definition.error ?? null,
  };
}
