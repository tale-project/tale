// @vitest-environment node

import { beforeAll, describe, expect, it } from 'vitest';

import { nodeVmRunner } from '../../runners/node-vm';
import { execute } from '../execute';
import { setCodeRunner } from '../slots';
import type { Automation } from '../types';
import { createRecorder } from './recorder';
import { TRANSIENT_DETAILS_MAX_BYTES, transientRecord } from './transient';

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
});

const DOC: Automation = {
  version: 1,
  name: 'draft-flow',
  nodes: [
    { id: 'list', type: 'transform', code: 'return [1, 2, 3];' },
    {
      id: 'square',
      type: 'transform',
      forEach: '{{ nodes.list.output }}',
      input: { n: '{{ item }}' },
      code: 'return input.n * input.n;',
    },
  ],
  output: '{{ nodes.square.output }}',
};

async function recorded(
  doc: Automation,
  opts: Parameters<typeof execute>[1] = {},
) {
  const startedAt = Date.now();
  const result = await execute(doc, {
    mode: 'mock',
    recorder: createRecorder({ now: () => Date.now() }),
    ...opts,
  });
  return { result, startedAt, finishedAt: Date.now() };
}

describe('transientRecord', () => {
  it('reads a run that was never stored the way a stored run is read', async () => {
    const { result, startedAt, finishedAt } = await recorded(DOC);
    const record = transientRecord({
      doc: DOC,
      result,
      id: 'try-1',
      startedAt,
      finishedAt,
    });
    expect(record?.view).toMatchObject({
      runId: 'try-1',
      source: 'transient',
      status: 'success',
      // A draft that was never saved has no version.
      version: 0,
      mode: 'mock',
      startedAt,
      finishedAt,
      events: [],
    });
    expect(record?.view.nodes.map((n) => [n.path, n.status])).toEqual([
      ['__start', 'succeeded'],
      ['list', 'succeeded'],
      ['square', 'succeeded'],
      ['__end', 'succeeded'],
    ]);
    // Every unit read whole: the steps first, then the items.
    expect(record?.details.map((d) => [d.path, d.item, d.pass])).toEqual([
      ['__start', -1, -1],
      ['list', -1, -1],
      ['square', -1, -1],
      ['__end', -1, -1],
      ['square', 0, -1],
      ['square', 1, -1],
      ['square', 2, -1],
    ]);
    expect(record?.details[4]?.output?.value).toBe(1);
    expect(record?.detailsTruncated).toBeUndefined();
  });

  it('reads a failed run as failed at its step, and a stopped one as stopped', async () => {
    const failing: Automation = {
      ...DOC,
      nodes: [{ id: 'boom', type: 'transform', code: 'return null;' }],
    };
    const failed = await recorded(failing);
    const failedView = transientRecord({
      doc: failing,
      result: failed.result,
      id: 'try-2',
      version: 3,
      startedAt: failed.startedAt,
      finishedAt: failed.finishedAt,
    })?.view;
    expect(failedView).toMatchObject({ status: 'failed', version: 3 });
    expect(failedView?.nodes.find((n) => n.path === 'boom')?.status).toBe(
      'failed',
    );

    const stop = new AbortController();
    stop.abort();
    const stopped = await recorded(DOC, { signal: stop.signal });
    expect(
      transientRecord({
        doc: DOC,
        result: stopped.result,
        id: 'try-3',
        startedAt: stopped.startedAt,
        finishedAt: stopped.finishedAt,
      })?.view.status,
    ).toBe('cancelled');
  });

  describe('a step test', () => {
    const FLOW: Automation = {
      version: 1,
      name: 'step-test',
      nodes: [
        { id: 'fetch', type: 'transform', code: 'return { n: 3 };' },
        {
          id: 'gate',
          type: 'transform',
          when: '{{ nodes.fetch.output.n > 1 }}',
          code: 'return "big";',
        },
        {
          id: 'other',
          type: 'transform',
          elseOf: 'gate',
          code: 'return "small";',
        },
        {
          id: 'send',
          type: 'transform',
          input: { v: '{{ nodes.gate.output }}' },
          code: 'return { sent: input.v };',
        },
        { id: 'side', type: 'transform', code: 'return 1;' },
      ],
      output: { v: '{{ nodes.send.output }}' },
    };

    async function stepTest(
      bench: NonNullable<Parameters<typeof execute>[1]>['bench'],
      doc: Automation = FLOW,
    ) {
      const { result, startedAt, finishedAt } = await recorded(doc, { bench });
      const record = transientRecord({
        doc,
        result,
        id: 'step-1',
        startedAt,
        finishedAt,
      });
      const rows = record?.view.nodes.map((n) => [
        n.path,
        n.status,
        n.meta.bench ?? null,
        n.notRun ?? null,
      ]);
      return { result, record, rows };
    }

    it('reads the steps it leaves out as left out, and End as never evaluated', async () => {
      const { result, record, rows } = await stepTest({ upTo: 'gate' });
      expect(result.status).toBe('success');
      expect(rows).toEqual([
        ['__start', 'succeeded', null, null],
        ['fetch', 'succeeded', null, null],
        ['gate', 'succeeded', null, null],
        ['other', 'not_run', 'left-out', null],
        ['send', 'not_run', 'left-out', null],
        ['side', 'not_run', 'left-out', null],
        // The document output is not evaluated in a step test.
        ['__end', 'not_run', 'left-out', null],
      ]);
      // A path read from part of the conditions is no path the
      // automation takes.
      expect(record?.view.path).toBeUndefined();
    });

    it('reads a node run alone with its pinned data, and no path from the pins', async () => {
      const { record, rows } = await stepTest({
        only: 'send',
        mocks: { gate: 'pinned' },
      });
      expect(rows).toEqual([
        ['__start', 'succeeded', null, null],
        ['fetch', 'not_run', 'left-out', null],
        ['gate', 'succeeded', 'pinned', null],
        ['other', 'not_run', 'left-out', null],
        ['send', 'succeeded', null, null],
        ['side', 'not_run', 'left-out', null],
        ['__end', 'not_run', 'left-out', null],
      ]);
      expect(record?.view.path).toBeUndefined();
    });

    it('reads what it leaves out as left out after a failure too, never as where the run ended', async () => {
      const failing = structuredClone(FLOW);
      const send = failing.nodes.find((n) => n.id === 'send');
      if (send !== undefined) send.code = 'return null;';
      const { result, rows } = await stepTest({ upTo: 'send' }, failing);
      expect(result.status).toBe('error');
      expect(result.trace.find((e) => e.node === 'side')).toMatchObject({
        status: 'not_run',
        bench: 'left-out',
      });
      expect(rows).toEqual([
        ['__start', 'succeeded', null, null],
        ['fetch', 'succeeded', null, null],
        ['gate', 'succeeded', null, null],
        ['other', 'not_run', 'left-out', null],
        ['send', 'failed', null, null],
        ['side', 'not_run', 'left-out', null],
        ['__end', 'not_run', 'left-out', null],
      ]);
    });
  });

  it('answers nothing for a run that kept no record', async () => {
    const result = await execute(DOC, { mode: 'mock' });
    expect(
      transientRecord({
        doc: DOC,
        result,
        id: 'try-4',
        startedAt: 0,
        finishedAt: 1,
      }),
    ).toBeUndefined();
  });

  it('leaves out the details past its size, items before steps', async () => {
    const wide: Automation = {
      version: 1,
      name: 'wide',
      nodes: [
        {
          id: 'blobs',
          type: 'transform',
          forEach: '{{ [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }}',
          code: 'return "x".repeat(4000) + item;',
        },
      ],
      output: '{{ nodes.blobs.output.length }}',
    };
    const { result, startedAt, finishedAt } = await recorded(wide);
    const full = transientRecord({
      doc: wide,
      result,
      id: 'try-5',
      startedAt,
      finishedAt,
    });
    expect(full?.detailsTruncated).toBeUndefined();
    // The same run, with every unit's value far past the size: the
    // details keep what fits and say that more was left out.
    const huge = structuredClone(result);
    for (const row of huge.record ?? []) {
      if (row.output !== undefined) {
        row.output.value = 'y'.repeat(TRANSIENT_DETAILS_MAX_BYTES / 4);
      }
    }
    const cut = transientRecord({
      doc: wide,
      result: huge,
      id: 'try-6',
      startedAt,
      finishedAt,
    });
    expect(cut?.detailsTruncated).toBe(true);
    expect(cut?.details.length).toBeLessThan(full?.details.length ?? 0);
    const bytes = new TextEncoder().encode(JSON.stringify(cut?.details)).length;
    expect(bytes).toBeLessThanOrEqual(TRANSIENT_DETAILS_MAX_BYTES + 64);
    // The steps came first.
    expect(cut?.details[0]?.path).toBe('__start');
  });
});
