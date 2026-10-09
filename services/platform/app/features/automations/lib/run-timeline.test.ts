import { buildPlaybackTimeline } from '@tale/ui/flow/playback';
import type { FlowGraph } from '@tale/ui/flow/types';
import { describe, expect, it } from 'vitest';

import type {
  NodeRunPage,
  RecordedStep,
  RunRecordView,
} from '@/app/lib/backend/contract/automations';

import {
  isUnit,
  realRunOf,
  unitPlace,
  unitRefOf,
  unitRefOfRow,
  unitRowId,
  withUnitSpans,
} from './run-timeline';

const graph: FlowGraph = {
  nodes: [
    { id: '__start', kind: 'entry', triggers: [], inputs: [] },
    { id: 'fetch', kind: 'step', label: 'Fetch' },
    {
      id: '__gate:notify',
      kind: 'gate',
      label: 'If',
      mode: 'only-if',
      condition: 'nodes.fetch.output.urgent',
    },
    { id: 'notify', kind: 'step', label: 'Notify' },
    { id: '__end', kind: 'exit', outputs: [] },
  ],
  edges: [
    { id: '__start>fetch', source: '__start', target: 'fetch', kind: 'entry' },
    {
      id: 'fetch>__gate:notify',
      source: 'fetch',
      target: '__gate:notify',
      kind: 'order',
    },
    {
      id: '__gate:notify>notify',
      source: '__gate:notify',
      target: 'notify',
      kind: 'branch-yes',
    },
    { id: 'fetch>__end', source: 'fetch', target: '__end', kind: 'exit' },
  ],
};

function step(path: string, over: Partial<RecordedStep> = {}): RecordedStep {
  return {
    path,
    nodeId: path,
    type: 'transform',
    status: 'succeeded',
    activeMs: 0,
    waitedMs: 0,
    attempt: 1,
    attempts: [],
    decisions: [],
    waits: [],
    meta: {},
    ...over,
  };
}

function record(over: Partial<RunRecordView> = {}): RunRecordView {
  return {
    format: 1,
    runId: 'run-1',
    status: 'success',
    version: 1,
    mode: 'live',
    startedAt: 1000,
    finishedAt: 1900,
    source: 'record',
    nodes: [
      step('__start', { startedAt: 1000, endedAt: 1000 }),
      step('fetch', { startedAt: 1010, endedAt: 1200 }),
      step('notify', {
        status: 'skipped',
        skip: { reason: 'when', at: 1210, chain: [] },
        decisions: [
          {
            kind: 'when',
            result: false,
            value: { kind: 'boolean', text: 'false' },
            trace: { pointer: '/nodes/1/when', units: [] },
            at: 1210,
          },
        ],
      }),
      step('batch[0:-1]/inner', {
        parentPath: 'batch',
        startedAt: 1300,
        endedAt: 1400,
      }),
      step('__end', { startedAt: 1900, endedAt: 1900 }),
    ],
    events: [],
    eventsTotal: 0,
    travels: [
      {
        from: { kind: 'node', nodeId: 'fetch' },
        to: {
          path: 'notify',
          field: 'when',
          pointer: '/nodes/1/when',
          range: [0, 24],
        },
        refPath: ['urgent'],
        at: 1210,
        edge: { source: 'fetch', target: 'notify', kind: 'order' },
      },
      {
        from: { kind: 'node', nodeId: 'ghost' },
        to: { path: 'fetch', field: 'input', pointer: '/x', range: [0, 1] },
        refPath: [],
        at: 1010,
        edge: { source: 'ghost', target: 'fetch', kind: 'data' },
      },
    ],
    cursor: 1900,
    ...over,
  };
}

describe('realRunOf', () => {
  it('plays each step of the graph, a condition’s decision in its gate, and the values that moved', () => {
    const run = realRunOf(record(), graph, {
      skipped: (s) =>
        s.skip?.reason === 'when' ? 'condition false' : undefined,
    });
    expect(run.startedAt).toBe(1000);
    expect(run.endedAt).toBe(1900);
    expect(run.spans).toEqual([
      {
        nodeId: '__start',
        startedAt: 1000,
        endedAt: 1000,
        outcome: 'succeeded',
      },
      { nodeId: 'fetch', startedAt: 1010, endedAt: 1200, outcome: 'succeeded' },
      {
        nodeId: 'notify',
        startedAt: 1210,
        endedAt: 1210,
        outcome: 'skipped',
        reason: 'condition false',
      },
      {
        nodeId: '__gate:notify',
        startedAt: 1210,
        endedAt: 1210,
        outcome: 'succeeded',
        decision: false,
      },
      { nodeId: '__end', startedAt: 1900, endedAt: 1900, outcome: 'succeeded' },
    ]);
    // The condition read `fetch` through its gate; a line the graph does
    // not have is left out.
    expect(run.travels).toEqual([
      { edgeId: 'fetch>__gate:notify', at: 1210, target: '__gate:notify' },
    ]);
    expect(() => buildPlaybackTimeline(run)).not.toThrow();
  });

  it('keeps a live run open: a running step has no end, and neither does the run', () => {
    const run = realRunOf(
      record({
        status: 'running',
        finishedAt: undefined,
        nodes: [
          step('__start', { startedAt: 1000, endedAt: 1000 }),
          step('fetch', {
            status: 'waiting',
            startedAt: 1010,
            waits: [{ kind: 'approval', since: 1050 }],
          }),
        ],
        travels: [],
      }),
      graph,
      { wait: (w) => `waiting for ${w.kind}` },
    );
    expect(run.endedAt).toBeUndefined();
    expect(run.spans.at(-1)).toEqual({
      nodeId: 'fetch',
      startedAt: 1010,
      outcome: 'waiting',
    });
    expect(run.waits).toEqual([
      { startedAt: 1050, label: 'waiting for approval' },
    ]);
  });

  it('plays a step a replay took from the run it replays as reused', () => {
    const run = realRunOf(
      record({
        nodes: [
          step('__start', { startedAt: 1000, endedAt: 1000 }),
          step('fetch', {
            status: 'reused',
            reused: { runId: 'run-0' },
            startedAt: 1005,
            endedAt: 1005,
          }),
        ],
        travels: [],
      }),
      graph,
    );
    expect(run.spans.at(-1)).toEqual({
      nodeId: 'fetch',
      startedAt: 1005,
      endedAt: 1005,
      outcome: 'reused',
    });
  });

  it('draws nothing for a step that has not started', () => {
    const run = realRunOf(
      record({
        status: 'running',
        nodes: [step('fetch', { status: 'pending' })],
        travels: [],
      }),
      graph,
    );
    expect(run.spans).toEqual([]);
  });
});

type Unit = NodeRunPage['units'][number];

function unit(
  item: number,
  pass: number,
  over: Partial<RecordedStep> = {},
): Unit {
  return { ...step('fetch', over), item, pass };
}

describe('withUnitSpans', () => {
  const counted = record({
    nodes: [
      step('__start', { startedAt: 1000, endedAt: 1000 }),
      step('fetch', {
        startedAt: 1010,
        endedAt: 1200,
        counts: { items: 3, ok: 2, failed: 1, skipped: 0, kept: 3 },
      }),
    ],
    travels: [],
  });

  it('says how many items a step ran over, before any is read', () => {
    const run = realRunOf(counted, graph);
    expect(run.spans.find((span) => span.nodeId === 'fetch')?.total).toBe(3);
    // A step that neither iterated nor repeated says nothing of the kind.
    expect(
      realRunOf(record(), graph).spans.some((span) => span.total !== undefined),
    ).toBe(false);
  });

  it('lays the items read where they ran, on the clock the run already plays', () => {
    const timeline = buildPlaybackTimeline(realRunOf(counted, graph));
    const read = withUnitSpans(
      timeline,
      new Map([
        [
          'fetch',
          [
            unit(0, -1, { startedAt: 1010, endedAt: 1050 }),
            unit(1, -1, { status: 'failed', startedAt: 1050, endedAt: 1100 }),
            // A pass of one item belongs to that item.
            unit(1, 0, { startedAt: 1050, endedAt: 1060 }),
            // Not started: nothing to draw.
            unit(2, -1, { status: 'pending' }),
          ],
        ],
      ]),
    );
    expect(read.duration).toBe(timeline.duration);
    expect(read.fromReal(1100)).toBe(timeline.fromReal(1100));
    expect(read.spans.slice(timeline.spans.length)).toEqual([
      {
        nodeId: 'fetch',
        start: timeline.fromReal(1010),
        end: timeline.fromReal(1050),
        outcome: 'succeeded',
        item: 0,
      },
      {
        nodeId: 'fetch',
        start: timeline.fromReal(1050),
        end: timeline.fromReal(1100),
        outcome: 'failed',
        item: 1,
      },
    ]);
    // Nothing read: the very same timeline.
    expect(withUnitSpans(timeline, new Map())).toBe(timeline);
  });

  it('counts a repeat’s passes from 1, as people do', () => {
    expect(unitPlace({ item: -1, pass: 0 })).toEqual({ pass: 1 });
    expect(unitPlace({ item: 4, pass: -1 })).toEqual({ item: 4 });
    const timeline = buildPlaybackTimeline(realRunOf(counted, graph));
    const read = withUnitSpans(
      timeline,
      new Map([['fetch', [unit(-1, 0, { startedAt: 1010, endedAt: 1020 })]]]),
    );
    expect(read.spans.at(-1)).toMatchObject({ nodeId: 'fetch', pass: 1 });
  });
});

describe('unit references', () => {
  it('round-trip between the record’s numbering and the Steps view’s rows', () => {
    expect(unitRefOf({ item: 3, pass: -1 })).toEqual({ item: 3 });
    expect(unitRefOf({ item: -1, pass: 0 })).toEqual({ pass: 0 });
    expect(unitRefOf({ item: 2, pass: 1 })).toEqual({ item: 2, pass: 1 });
    expect(isUnit({ item: 3 }, { item: 3, pass: -1 })).toBe(true);
    expect(isUnit({ item: 3 }, { item: 3, pass: 0 })).toBe(false);
    expect(unitRowId('score', { item: 3 })).toBe('score#item:3');
    // The record's first pass is the Steps view's Pass 1.
    expect(unitRowId('poll', { pass: 0 })).toBe('poll#pass:1');
    expect(unitRefOfRow({ pass: 1 })).toEqual({ pass: 0 });
    expect(unitRefOfRow({ item: 3 })).toEqual({ item: 3 });
    // A pass of one item shows on its item's row.
    expect(unitRowId('score', { item: 2, pass: 1 })).toBe('score#item:2');
  });
});
