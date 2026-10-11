import { describe, expect, it } from 'vitest';

import { execute } from '@/lib/engine/core/execute';
import { createRecorder } from '@/lib/engine/core/record/recorder';
import { transientRecord } from '@/lib/engine/core/record/transient';
import type { Automation, NodeTrace, RunBench } from '@/lib/engine/core/types';

import type { TestOutcome } from './test-results';
import {
  testRunOf,
  transientStatus,
  transientTrace,
  type TransientRunLike,
} from './transient-run';

// Every step stands in (a bench) and every template is a plain path: the
// run needs no code runner.
const DOC: Automation = {
  version: 1,
  name: 'order-discounts',
  nodes: [
    { id: 'rates', type: 'transform', code: 'return { chf: 1 };' },
    {
      id: 'discount',
      type: 'transform',
      input: { quantity: '{{ input.quantity }}' },
      code: 'return { rate: input.quantity >= 100 ? 0.05 : 0 };',
    },
  ],
  output: '{{ nodes.discount.output }}',
};

/** A run of `doc` the way a try or a test answers it, with its record. */
async function answered(
  doc: Automation,
  input: unknown,
  bench?: RunBench,
): Promise<{ run: TransientRunLike; trace: readonly NodeTrace[] }> {
  const startedAt = Date.now();
  const result = await execute(doc, {
    mode: 'mock',
    input,
    recorder: createRecorder({ now: () => Date.now() }),
    ...(bench !== undefined && { bench }),
  });
  const record = transientRecord({
    doc,
    result,
    id: 'try-1',
    startedAt,
    finishedAt: Date.now(),
  });
  return {
    run: {
      status: result.status,
      ...(result.error !== undefined && { error: result.error }),
      effects: result.effects,
      ...(record !== undefined && { record }),
    },
    trace: result.trace,
  };
}

/** What the canvas reads of a step. */
function shown(trace: readonly NodeTrace[]) {
  return trace.map(({ node, type, status, output, error, bench }) => ({
    node,
    type,
    status,
    ...(output !== undefined && { output }),
    ...(error !== undefined && { error }),
    ...(bench !== undefined && { bench }),
  }));
}

describe('a run that was never stored, read for the canvas', () => {
  it('reads a test run back from its record as the run traced it', async () => {
    const { run, trace } = await answered(
      DOC,
      { quantity: 120 },
      { mocks: { rates: { chf: 2 }, discount: { rate: 0.05 } } },
    );
    const read = transientTrace(run);
    expect(read.map((step) => step.node)).toEqual(['rates', 'discount']);
    expect(shown(read)).toEqual(shown(trace));
    expect(read.find((step) => step.node === 'rates')).toMatchObject({
      status: 'ok',
      output: { chf: 2 },
      bench: 'mocked',
    });
  });

  it('keeps a try’s own trace, and reads a failed step with its message', async () => {
    const { run, trace } = await answered(
      DOC,
      { quantity: 3 },
      {
        mocks: { rates: { chf: 2 } },
        failures: { discount: 'no rate for this order' },
      },
    );
    expect(transientStatus(run)).toBe('failed');
    const read = transientTrace(run);
    expect(read.find((step) => step.node === 'discount')).toMatchObject({
      status: 'error',
      bench: 'failed',
    });
    expect(read.find((step) => step.node === 'discount')?.error).toContain(
      'no rate for this order',
    );
    expect(transientTrace({ ...run, trace })).toBe(trace);
  });

  it('says how a run ended in a stored run’s words', () => {
    expect(transientStatus({ status: 'success' })).toBe('success');
    expect(transientStatus({ status: 'invalid' })).toBe('failed');
    expect(transientStatus({ status: 'error', stoppedBy: 'time_limit' })).toBe(
      'cancelled',
    );
    expect(transientTrace({ status: 'success' })).toEqual([]);
  });
});

describe('a test result’s run', () => {
  it('is laid over the canvas only when the result keeps its steps', async () => {
    const { run } = await answered(
      DOC,
      { quantity: 3 },
      { mocks: { rates: { chf: 2 }, discount: { rate: 0 } } },
    );
    const result = {
      name: 'small order',
      pass: true,
      ms: 4,
      failures: [],
    };
    const of = (outcome: unknown) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a result as the store keeps it, built by hand
      testRunOf(outcome as TestOutcome);
    expect(of({ kind: 'none' })).toBeNull();
    expect(of({ kind: 'report', result, stale: false, at: 1 })).toBeNull();
    expect(
      of({ kind: 'run', result: { ...result }, stale: false, at: 1 }),
    ).toBeNull();
    expect(
      of({
        kind: 'run',
        result: { ...result, run: { ...run, record: undefined } },
        stale: false,
        at: 1,
      }),
    ).toBeNull();
    expect(
      of({ kind: 'run', result: { ...result, run }, stale: false, at: 1 }),
    ).toBe(run);
  });
});
