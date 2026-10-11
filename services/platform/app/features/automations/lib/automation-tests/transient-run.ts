/**
 * A run that was never stored — a try of the draft, a test's run — laid
 * over the canvas the way the last stored run is. A try answers its trace;
 * a test's run keeps only its record (each step's status, and its values
 * read whole), so its trace is read back from the record.
 */

import type { NodeRunDetail } from '@/lib/engine/core/record/read';
import type { TransientRecord } from '@/lib/engine/core/record/transient';
import { END_PATH, START_PATH } from '@/lib/engine/core/record/types';
import type {
  Effect,
  NodeStatus,
  NodeTrace,
  RunError,
} from '@/lib/engine/core/types';

import { benchMarkOf } from '../run-view';
import type { TestOutcome } from './test-results';

/** A run as a try or a test's result answers it. */
export interface TransientRunLike {
  status: 'success' | 'error' | 'invalid';
  output?: unknown;
  error?: RunError;
  trace?: readonly NodeTrace[];
  effects?: readonly Effect[];
  stoppedBy?: 'time_limit' | 'cancelled';
  record?: TransientRecord;
}

/** What is laid over the canvas in place of the last run: a try of the
 * draft, or a test's latest run. */
export type TransientOverlay =
  | {
      kind: 'try';
      run: TransientRunLike & { ms: number };
      /** What the try ran with, for Try again. */
      input: unknown;
      /** The draft's hash as it was tried: a draft changed since reads so. */
      documentHash: string;
      /** When the answer came, epoch ms. */
      at: number;
    }
  | {
      kind: 'test';
      /** The test's place in the document; its latest run is read from
       * the results, so a run again shows at once. */
      index: number;
    };

/** A test's latest run, when its result keeps one with the steps to lay
 * over the canvas: a result from a version's kept report, or one too large
 * to answer whole, keeps none. */
export function testRunOf(outcome: TestOutcome): TransientRunLike | null {
  if (outcome.kind !== 'run') return null;
  const run = outcome.result.run;
  return run?.record === undefined ? null : run;
}

/** How a run that was never stored ended, in the words a stored run's
 * status uses. */
export type TransientStatus = 'success' | 'failed' | 'cancelled';

/** How the run ended: a run stopped at its time limit reads as stopped. */
export function transientStatus(
  run: Pick<TransientRunLike, 'status' | 'stoppedBy'>,
): TransientStatus {
  if (run.stoppedBy !== undefined) return 'cancelled';
  return run.status === 'success' ? 'success' : 'failed';
}

const STEP_STATUS: Readonly<Partial<Record<string, NodeStatus>>> = {
  succeeded: 'ok',
  reused: 'ok',
  failed: 'error',
  skipped: 'skipped',
};

/** The record's own value of a step's top-level unit, keyed by the step. */
function stepDetails(
  details: readonly NodeRunDetail[],
): Map<string, NodeRunDetail> {
  const byPath = new Map<string, NodeRunDetail>();
  for (const detail of details) {
    if (detail.item >= 0 || detail.pass >= 0) continue;
    byPath.set(detail.path, detail);
  }
  return byPath;
}

/**
 * Each step of the run with what it read and returned: the run's own
 * trace, or — for a run that keeps only its record — the record's steps of
 * the automation itself (not Start, End, nor the steps of an automation it
 * called), with the values the record read whole.
 */
export function transientTrace(run: TransientRunLike): readonly NodeTrace[] {
  if (run.trace !== undefined && run.trace.length > 0) return run.trace;
  const record = run.record;
  if (record === undefined) return [];
  const details = stepDetails(record.details);
  return record.view.nodes.flatMap((step): NodeTrace[] => {
    if (
      step.parentPath !== undefined ||
      step.path === START_PATH ||
      step.path === END_PATH
    ) {
      return [];
    }
    const detail = details.get(step.path);
    const bench = benchMarkOf(step.meta.bench);
    return [
      {
        node: step.nodeId,
        type: step.type,
        status: STEP_STATUS[step.status] ?? 'not_run',
        ...(detail?.input?.value !== undefined && {
          input: detail.input.value,
        }),
        ...(detail?.output?.value !== undefined && {
          output: detail.output.value,
        }),
        ...(step.failure !== undefined && { error: step.failure.message }),
        ...(step.activeMs > 0 && { ms: step.activeMs }),
        ...(bench !== undefined && { bench }),
      },
    ];
  });
}
