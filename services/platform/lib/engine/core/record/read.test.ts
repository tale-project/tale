// @vitest-environment node

import { beforeAll, describe, expect, it } from 'vitest';

import { nodeVmRunner } from '../../runners/node-vm';
import { execute } from '../execute';
import { setCodeRunner } from '../runner';
import type { Automation } from '../types';
import {
  detailWithinBudget,
  NODE_DETAIL_MAX_BYTES,
  nodeDetail,
  type NodeRunDetail,
  type RecordedStep,
  RUN_RECORD_MAX_BYTES,
  type RunRecordView,
  runFactsOf,
  withinBudget,
} from './read';
import { createRecorder } from './recorder';
import type { NodeRunRecord } from './types';
import { recordValue, unlimitedBudget } from './value';
import type { RunFacts } from './view';

const bytesOf = (answer: RunRecordView): number =>
  new TextEncoder().encode(JSON.stringify(answer)).length;

function step(path: string, over: Partial<RecordedStep> = {}): RecordedStep {
  return {
    path,
    nodeId: path.split('/').at(-1) ?? path,
    type: 'echo',
    status: 'succeeded',
    activeMs: 1,
    waitedMs: 0,
    attempt: 1,
    attempts: [],
    decisions: [],
    waits: [],
    meta: {},
    ...over,
  };
}

function view(nodes: RecordedStep[], over: Partial<RunRecordView> = {}) {
  const answer: RunRecordView = {
    format: 1,
    runId: 'run-1',
    status: 'failed',
    version: 1,
    mode: 'live',
    startedAt: 1000,
    source: 'record',
    nodes,
    events: [],
    eventsTotal: 0,
    cursor: 1000,
    ...over,
  };
  return answer;
}

/** A shape `depth` levels deep, `width` fields wide at each level. */
function deepShape(depth: number, width: number): object {
  if (depth === 0) return { type: 'string' };
  return {
    type: 'object',
    properties: Object.fromEntries(
      Array.from({ length: width }, (_, i) => [
        `field_${i}`,
        deepShape(depth - 1, width),
      ]),
    ),
  };
}

describe('withinBudget', () => {
  it('answers a record that fits as it is', () => {
    const fits = view([step('one')]);
    expect(withinBudget(fits)).toBe(fits);
  });

  it('cuts shapes to one level first', () => {
    const output = {
      summary: { kind: 'object' as const },
      shape: deepShape(3, 12),
      bytes: 10,
      elided: false,
      redactions: 0,
    };
    const nodes = Array.from({ length: 40 }, (_, i) =>
      step(`s${i}`, { output }),
    );
    const answer = withinBudget(view(nodes));
    expect(answer.truncated).toEqual({ shapes: true });
    expect(answer.nodes).toHaveLength(40);
    expect(
      Object.values(answer.nodes[0]?.output?.shape.properties ?? {})[0],
    ).not.toHaveProperty('properties');
    expect(bytesOf(answer)).toBeLessThanOrEqual(RUN_RECORD_MAX_BYTES);
  });

  it('then leaves steps out, nested ones first, never the step the run stopped at', () => {
    const long = 'x'.repeat(400);
    const nested = Array.from({ length: 1500 }, (_, i) =>
      step(`batch[${i}:-1]/inner_${long}`, {
        parentPath: 'batch',
        parentItem: i,
      }),
    );
    const top = Array.from({ length: 30 }, (_, i) => step(`s${i}`));
    const answer = withinBudget(
      view(
        [step('batch'), ...nested, ...top, step('last', { status: 'failed' })],
        {
          path: { id: 'p', assignment: {}, stoppedAt: 'last' },
          travels: [],
          travelsTotal: 0,
        },
      ),
    );
    expect(answer.truncated).toMatchObject({
      explanations: true,
      travels: true,
      nodes: true,
    });
    expect(answer.travels).toBeUndefined();
    const paths = answer.nodes.map((node) => node.path);
    // Every top-level step stays, in order, with what nested steps fit.
    expect(paths.filter((p) => !p.includes('/'))).toEqual([
      'batch',
      ...top.map((node) => node.path),
      'last',
    ]);
    expect(paths.length).toBeLessThan(1532);
    expect(paths[1]).toMatch(/^batch\[0:-1\]\//);
    expect(bytesOf(answer)).toBeLessThanOrEqual(RUN_RECORD_MAX_BYTES);
  });

  it('measures its size in UTF-8 bytes', () => {
    // Three bytes a character: past the budget as bytes, not as characters.
    const wide = '語'.repeat(1000);
    const nodes = Array.from({ length: 200 }, (_, i) =>
      step(`s${i}`, { meta: { model: wide } }),
    );
    const answer = withinBudget(view(nodes));
    expect(JSON.stringify(view(nodes)).length).toBeLessThan(
      RUN_RECORD_MAX_BYTES,
    );
    expect(answer.truncated?.nodes).toBe(true);
    expect(bytesOf(answer)).toBeLessThanOrEqual(RUN_RECORD_MAX_BYTES);
  });
});

describe('runFactsOf', () => {
  const row = (
    path: string,
    status: NodeRunRecord['status'],
  ): NodeRunRecord => ({
    key: { path, item: -1, pass: -1 },
    nodeId: path,
    nodeType: 'echo',
    status,
    activeMs: 0,
    attempt: 1,
    attempts: [],
    decisions: [],
    waits: [],
    meta: {},
  });

  it('names where a run ended: its failed step, the one a stop cut off, or the one its detail names', () => {
    const records = [row('fetch', 'ok'), row('send', 'failed')];
    expect(runFactsOf({ status: 'failed' }, records, 5)).toEqual({
      status: 'failed',
      finished: true,
      failedNode: 'send',
      now: 5,
    });
    expect(
      runFactsOf(
        { status: 'cancelled', finishedAt: 9 },
        [row('fetch', 'running')],
        5,
      ),
    ).toMatchObject({ failedNode: 'fetch', finishedAt: 9 });
    expect(
      runFactsOf({ status: 'failed', detail: 'send: refused' }, [], 5),
    ).toMatchObject({ failedNode: 'send' });
    expect(runFactsOf({ status: 'running' }, records, 5)).toEqual({
      status: 'running',
      finished: false,
      now: 5,
    });
  });
});

describe('nodeDetail', () => {
  const doc: Automation = {
    version: 1,
    name: 'greet',
    nodes: [
      {
        id: 'fetch',
        type: 'transform',
        input: { n: '{{ input.n }}' },
        code: 'return { n: input.n, name: "Ada" };',
      },
      {
        id: 'greet',
        type: 'transform',
        input: { line: 'Hello {{ nodes.fetch.output.name }}!', n: 1 },
        code: 'return { line: input.line, n: input.n + 1 };',
      },
    ],
    output: '{{ nodes.greet.output }}',
  };
  let records: NodeRunRecord[] = [];

  beforeAll(async () => {
    setCodeRunner(nodeVmRunner());
    const result = await execute(doc, {
      input: { n: 2 },
      mode: 'mock',
      recorder: createRecorder({ now: () => Date.now() }),
    });
    records = result.record ?? [];
  });

  const facts: RunFacts = { status: 'success', finished: true };

  it('reads a step whole: values, where its text landed, what it read, how it changed', () => {
    const detail = nodeDetail({
      doc,
      records,
      facts,
      path: 'greet',
      item: -1,
      pass: -1,
    });
    expect(detail).toMatchObject({
      path: 'greet',
      item: -1,
      pass: -1,
      status: 'succeeded',
      input: { value: { line: 'Hello Ada!', n: 1 } },
      output: { value: { line: 'Hello Ada!', n: 2 } },
      change: { equal: false, changes: [{ pointer: '/n', kind: 'changed' }] },
    });
    expect(
      detail?.reads.map((travel) => [travel.edge.source, travel.refPath]),
    ).toEqual([['fetch', ['name']]]);
  });

  it('places where each unit of a sent text landed, leaving out spans past a cut', () => {
    // Text a step sends past the node tier's 4096 characters is cut.
    const long = `Hello Ada, ${'x'.repeat(5000)} — {{ tail }}`;
    const sent: NodeRunRecord = {
      ...(records.find((r) => r.key.path === 'greet') ?? records[0]!),
      input: recordValue({ line: long }, 'node', unlimitedBudget()),
      meta: {
        rendered: {
          '/nodes/1/input/line': [
            { unit: [6, 39], out: [6, 9] },
            { unit: [50, 60], out: [5014, 5020] },
          ],
          '/nodes/1/prompt': [{ unit: [0, 5], out: [0, 3] }],
        },
      },
    };
    const detail = nodeDetail({
      doc,
      records: [...records.filter((r) => r.key.path !== 'greet'), sent],
      facts,
      path: 'greet',
      item: -1,
      pass: -1,
    });
    expect(detail?.rendered).toEqual({
      '/nodes/1/input/line': {
        at: '/line',
        spans: [{ unit: [6, 39], out: [6, 9] }],
        cut: true,
      },
      // Not in the stored input: every span kept, and no place named.
      '/nodes/1/prompt': { at: null, spans: [{ unit: [0, 5], out: [0, 3] }] },
    });
  });

  it('answers nothing for a unit the record does not hold', () => {
    expect(
      nodeDetail({ doc, records, facts, path: 'greet', item: 3, pass: -1 }),
    ).toBeNull();
    expect(
      nodeDetail({ doc, records, facts, path: 'ghost', item: -1, pass: -1 }),
    ).toBeNull();
  });
});

describe('detailWithinBudget', () => {
  it('leaves out a call’s values first, then what the unit read', () => {
    const big = recordValue(
      { body: 'x'.repeat(40_000), more: 'y'.repeat(40_000) },
      'transient',
      unlimitedBudget(),
    );
    const detail: NodeRunDetail = {
      path: 'send',
      item: -1,
      pass: -1,
      nodeId: 'send',
      type: 'http.post',
      status: 'succeeded',
      activeMs: 1,
      waitedMs: 0,
      attempt: 1,
      attempts: [],
      decisions: [],
      waits: [],
      meta: {},
      reads: [],
      readsTotal: 0,
      call: {
        kind: 'connector',
        type: 'http.post',
        attempt: 1,
        status: 'done',
        startedAt: 1,
        input: big,
        output: big,
      },
    };
    // Four values of 80 KB each: past the budget until the call's two go.
    const fitted = detailWithinBudget({ ...detail, input: big, output: big });
    expect(fitted.truncated).toEqual({ call: true });
    expect(fitted.call).not.toHaveProperty('input');
    expect(fitted.call?.status).toBe('done');
    expect(
      new TextEncoder().encode(JSON.stringify(fitted)).length,
    ).toBeLessThanOrEqual(NODE_DETAIL_MAX_BYTES);
  });
});
