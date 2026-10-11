/**
 * A run as the test builder (`testFromRun`) reads it, from where the editor
 * has one: a stored run's detail — its input, output, trace, checkpoints
 * and effects as the run page reads them — or a try of the draft. The
 * builder is pure and withholds what looks like a secret itself, so the
 * test is made here, in the browser, from what the reader may already see.
 */

import type { RunForTest } from '@/lib/automations/tests/test-from-run';

import { projectRun } from '../run-view';
import { transientTrace, type TransientOverlay } from './transient-run';

/** A stored run's detail, as the app answers it. */
export interface StoredRunDetail {
  mode: string;
  status: string;
  input: unknown;
  output?: unknown;
  trace?: unknown;
  checkpoints?: unknown;
  effects?: unknown;
  startedAt: number;
}

/** A stored run for the builder: its steps read as the canvas reads them,
 * and where it failed, from the last step that failed. */
export function runForTestOfDetail(detail: StoredRunDetail): RunForTest {
  const projection = projectRun(detail);
  const failed = projection.trace.findLast((entry) => entry.status === 'error');
  return {
    mode: detail.mode,
    status: detail.status,
    input: detail.input,
    ...(detail.output !== undefined && { output: detail.output }),
    ...(detail.checkpoints !== undefined && {
      checkpoints: detail.checkpoints,
    }),
    trace: projection.trace,
    effects: projection.effects,
    ...(failed !== undefined && {
      error: {
        nodeId: failed.node,
        ...(failed.error !== undefined && { message: failed.error }),
      },
    }),
    startedAt: detail.startedAt,
  };
}

/** A try of the draft for the builder: a mock run made in one call. */
export function runForTestOfTry(
  overlay: Extract<TransientOverlay, { kind: 'try' }>,
): RunForTest {
  const { run } = overlay;
  return {
    mode: 'mock',
    status: run.status,
    input: overlay.input,
    ...(run.output !== undefined && { output: run.output }),
    trace: transientTrace(run),
    effects: run.effects ?? [],
    ...(run.error !== undefined && {
      error: {
        ...(run.error.nodeId !== undefined && { nodeId: run.error.nodeId }),
        message: run.error.message,
      },
    }),
    startedAt: overlay.at,
  };
}
