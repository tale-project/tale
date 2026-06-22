/**
 * Per-node execution statuses, derived server-side from the step journal and
 * the execution row. One compact reactive payload keyed by step slug drives
 * the canvas node badges (#1487), the test-panel per-step feedback (#1484)
 * and the step-debug inspector (#1490).
 */

import { getNumber, getString, isRecord } from '../../../lib/utils/type-utils';
import type { Doc, Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { parseDebugWaitingFor } from '../../workflow_engine/helpers/engine/debug_gate';
import { getExecutionStepJournal } from './get_execution_step_journal';

/** Per-node output previews are capped server-side to keep the reactive payload small. */
export const OUTPUT_PREVIEW_MAX_CHARS = 8 * 1024;

export type ExecutionNodeStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'waiting'
  | 'paused'
  | 'canceled';

export interface ExecutionNodeState {
  status: ExecutionNodeStatus;
  stepName?: string;
  stepType?: string;
  /** Number of journal entries for this slug (loop iterations / retries). */
  attempts: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  /** JSON-stringified `steps.<slug>.output`, capped at OUTPUT_PREVIEW_MAX_CHARS. */
  outputPreview?: string;
  outputTruncated?: boolean;
  /** Variables were offloaded to storage — outputs are not readable from a query. */
  outputUnavailable?: boolean;
}

export interface ExecutionStepStatuses {
  execution: {
    status: Doc<'wfExecutions'>['status'];
    /** Workflow slug + org so a UI can read the matching DEFINITION (steps +
     * `ui`/`role` annotations) from one reactive payload, no extra fetch. */
    workflowSlug?: string;
    organizationId: string;
    currentStepSlug?: string;
    currentStepName?: string;
    waitingFor?: string;
    loopProgress?: { current: number; total: number };
    error?: string;
    errorCode?: string;
    startedAt: number;
    completedAt?: number;
  };
  nodes: Record<string, ExecutionNodeState>;
}

interface JournalStepFields {
  stepSlug: string;
  stepType?: string;
  stepName?: string;
  argsError?: string;
  inProgress: boolean;
  startedAt?: number;
  completedAt?: number;
  runResult?: Record<string, unknown>;
}

/**
 * Extract the fields we care about from one untyped journal entry. Returns
 * null for framework entries (status mutations, awaitEvent, output
 * serialization, …) — only entries whose args carry a `stepSlug` describe a
 * canvas node.
 */
function parseJournalEntry(entry: unknown): JournalStepFields | null {
  if (!isRecord(entry)) return null;
  const step = entry.step;
  if (!isRecord(step)) return null;
  const args = step.args;
  if (!isRecord(args)) return null;
  const stepSlug = getString(args, 'stepSlug');
  if (!stepSlug) return null;

  return {
    stepSlug,
    stepType: getString(args, 'stepType'),
    stepName: getString(args, 'stepName') ?? getString(step, 'name'),
    argsError: getString(args, 'error'),
    inProgress: step.inProgress === true,
    startedAt: getNumber(step, 'startedAt'),
    completedAt: getNumber(step, 'completedAt'),
    runResult: isRecord(step.runResult) ? step.runResult : undefined,
  };
}

function deriveEntryStatus(
  fields: JournalStepFields,
): Pick<ExecutionNodeState, 'status' | 'error'> {
  // `recordBodyStepFailure` entries (continueOnError loop bodies) carry the
  // error in args and no stepType; the action itself succeeds, so the
  // runResult is not authoritative for them.
  if (!fields.stepType && fields.argsError !== undefined) {
    return { status: 'failed', error: fields.argsError };
  }
  if (fields.inProgress) return { status: 'running' };

  const runResult = fields.runResult;
  const kind = runResult ? getString(runResult, 'kind') : undefined;
  if (kind === 'failed') {
    return {
      status: 'failed',
      error: runResult ? getString(runResult, 'error') : undefined,
    };
  }
  if (kind === 'canceled') return { status: 'canceled' };
  if (kind === 'success') {
    // executeStep returns `{ port, error? }`. The action resolving `success`
    // does NOT mean the step settled — its routing port carries that.
    const returnValue = runResult?.returnValue;
    if (isRecord(returnValue)) {
      const port = getString(returnValue, 'port');
      // A step that routed through its error port failed even though the
      // action itself resolved successfully.
      if (port === 'error') {
        return { status: 'failed', error: getString(returnValue, 'error') };
      }
      // A DURABLE sandbox step crosses each <10-min action boundary by
      // returning on the INTERNAL `running` control port (the handler re-enters
      // the SAME step — see dynamic_workflow_handler). The STEP is still
      // running, so it must read `running` — otherwise the run view sees a
      // momentary terminal node, drops the live transcript, and flashes the
      // `{status:'running'}` handoff envelope as raw JSON each seam.
      if (port === 'running') return { status: 'running' };
    }
    return { status: 'success' };
  }
  // No runResult and not in progress: scheduled but not started yet.
  return { status: 'running' };
}

interface StepOutputs {
  outputs: Map<string, unknown>;
  unavailable: boolean;
}

/** Read per-step outputs from the execution's inline variables JSON. */
function readStepOutputs(execution: Doc<'wfExecutions'>): StepOutputs {
  const empty: StepOutputs = { outputs: new Map(), unavailable: false };
  if (!execution.variables) return empty;

  let parsed: unknown;
  try {
    parsed = JSON.parse(execution.variables);
  } catch (error) {
    console.warn(
      `getExecutionStepStatuses: failed to parse variables for execution ${execution._id}:`,
      error,
    );
    return empty;
  }
  if (!isRecord(parsed)) return empty;
  if (parsed._storageRef !== undefined) {
    // Variables were offloaded to Convex storage (≥400KB) — not readable here.
    return { outputs: new Map(), unavailable: true };
  }

  const steps = parsed.steps;
  if (!isRecord(steps)) return empty;

  const outputs = new Map<string, unknown>();
  for (const [slug, info] of Object.entries(steps)) {
    if (isRecord(info) && 'output' in info) {
      outputs.set(slug, info.output);
    }
  }
  return { outputs, unavailable: false };
}

function buildOutputPreview(
  output: unknown,
): Pick<ExecutionNodeState, 'outputPreview' | 'outputTruncated'> {
  const json = JSON.stringify(output);
  if (typeof json !== 'string') return {};
  if (json.length > OUTPUT_PREVIEW_MAX_CHARS) {
    return {
      outputPreview: json.slice(0, OUTPUT_PREVIEW_MAX_CHARS),
      outputTruncated: true,
    };
  }
  return { outputPreview: json };
}

/**
 * Pure derivation: fold the (stepNumber-ordered) journal entries into one
 * latest-wins state per step slug, then overlay execution-level facts
 * (waiting-for-input, output previews).
 */
export function deriveStepStatuses(
  journalEntries: Array<unknown>,
  execution: Doc<'wfExecutions'>,
): ExecutionStepStatuses {
  const nodes: Record<string, ExecutionNodeState> = {};

  for (const entry of journalEntries) {
    const fields = parseJournalEntry(entry);
    if (!fields) continue;

    const previous = nodes[fields.stepSlug];
    const { status, error } = deriveEntryStatus(fields);
    // Entries arrive sorted by stepNumber, so the last entry per slug wins —
    // for loops this surfaces the latest iteration's status. Only real
    // executeStep entries count as attempts; a recordBodyStepFailure entry
    // re-describes an executeStep failure that was already counted.
    nodes[fields.stepSlug] = {
      status,
      stepName: fields.stepName ?? previous?.stepName,
      stepType: fields.stepType ?? previous?.stepType,
      attempts: (previous?.attempts ?? 0) + (fields.stepType ? 1 : 0),
      startedAt: fields.startedAt ?? previous?.startedAt,
      completedAt: fields.completedAt,
      error,
    };
  }

  // A running execution that waits on an external event shows the current
  // node as 'waiting' (human input / approval) or 'paused' (debug-mode step
  // gate — the node has not executed yet, it is paused right before running).
  if (
    execution.status === 'running' &&
    execution.waitingFor &&
    execution.currentStepSlug
  ) {
    const overlayStatus = parseDebugWaitingFor(execution.waitingFor)
      ? 'paused'
      : 'waiting';
    const current = nodes[execution.currentStepSlug];
    nodes[execution.currentStepSlug] = current
      ? { ...current, status: overlayStatus }
      : {
          status: overlayStatus,
          stepName: execution.currentStepName,
          attempts: 0,
        };
  }

  // A SETTLED execution has no live step. Two ways a step is stranded mid-run
  // when the run is stopped (a user Stop → status 'failed' + errorCode
  // 'canceled') or hard-fails:
  //   1. cancelling the component workflow never writes a terminal runResult
  //      to the in-progress entry, so the node reads `running` forever; and
  //   2. once the component workflow's journal is GC'd (cleanupComponentWorkflow,
  //      ~10s later) the entry is gone, so the current step has no node at all.
  // Either way the run view would otherwise keep flashing a "Running"/"Live"
  // (case 1) or a pending skeleton (case 2) for a step the run has abandoned.
  // Settle the step status against the terminal outcome.
  if (execution.status === 'completed' || execution.status === 'failed') {
    const settled: ExecutionNodeStatus =
      execution.status === 'completed' ? 'success' : 'canceled';
    // A user Stop sets a run-level reason that genuinely describes the
    // abandoned step; a generic failure's reason belongs to the step that
    // actually failed, not its stranded siblings, so don't borrow it.
    const settledError =
      execution.errorCode === 'canceled' ? execution.error : undefined;
    for (const node of Object.values(nodes)) {
      if (
        node.status === 'running' ||
        node.status === 'waiting' ||
        node.status === 'paused'
      ) {
        node.status = settled;
        if (settledError !== undefined && node.error === undefined) {
          node.error = settledError;
        }
      }
    }
    // (case 2) The current step's journal entry may already be GC'd —
    // synthesize a settled node so it doesn't fall back to a loading skeleton.
    if (execution.currentStepSlug && !nodes[execution.currentStepSlug]) {
      nodes[execution.currentStepSlug] = {
        status: settled,
        stepName: execution.currentStepName,
        attempts: 0,
        ...(settledError !== undefined && { error: settledError }),
      };
    }
  }

  const { outputs, unavailable } = readStepOutputs(execution);
  for (const [slug, node] of Object.entries(nodes)) {
    if (unavailable) {
      node.outputUnavailable = true;
      continue;
    }
    if (outputs.has(slug)) {
      Object.assign(node, buildOutputPreview(outputs.get(slug)));
    }
  }

  return {
    execution: {
      status: execution.status,
      ...(execution.workflowSlug !== undefined && {
        workflowSlug: execution.workflowSlug,
      }),
      organizationId: execution.organizationId,
      currentStepSlug: execution.currentStepSlug,
      currentStepName: execution.currentStepName,
      waitingFor: execution.waitingFor,
      loopProgress: execution.loopProgress,
      error: execution.error,
      errorCode: execution.errorCode,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
    },
    nodes,
  };
}

export type GetExecutionStepStatusesArgs = {
  executionId: Id<'wfExecutions'>;
};

export async function getExecutionStepStatuses(
  ctx: QueryCtx,
  args: GetExecutionStepStatusesArgs,
): Promise<ExecutionStepStatuses | null> {
  const execution = await ctx.db.get(args.executionId);
  if (!execution) return null;

  const journalEntries = await getExecutionStepJournal(ctx, {
    executionId: args.executionId,
  });
  return deriveStepStatuses(journalEntries, execution);
}
