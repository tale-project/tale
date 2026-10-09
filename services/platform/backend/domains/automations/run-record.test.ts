// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  eventView,
  type RecordedStep,
  RUN_RECORD_MAX_BYTES,
  type RunRecordView,
  withinBudget,
} from './run-record.ts';

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

describe('eventView', () => {
  it('answers where, why and who decided — never the process that saw it', () => {
    expect(
      eventView({
        id: 'ev-1',
        at: 5,
        kind: 'in_doubt_resolved',
        detail: {
          path: 'save',
          itemIndex: 2,
          pass: 0,
          reason: 'lease_expired',
          resolution: 'skip',
          resolvedBy: 'user-1',
          instance: 'host:1:v1:blue',
          release: '0.5.70',
        },
      }),
    ).toEqual({
      id: 'ev-1',
      at: 5,
      kind: 'in_doubt_resolved',
      nodeId: 'save',
      itemIndex: 2,
      pass: 0,
      reason: 'lease_expired',
      resolution: 'skip',
      by: 'user-1',
    });
    expect(
      eventView({ id: 'ev-2', at: 6, kind: 'taken_over', detail: 'text' }),
    ).toEqual({ id: 'ev-2', at: 6, kind: 'taken_over' });
    expect(
      eventView({
        id: 'ev-3',
        at: 7,
        kind: 'in_doubt_resolved',
        detail: { resolution: 'drop tables' },
      }),
    ).toEqual({ id: 'ev-3', at: 7, kind: 'in_doubt_resolved' });
  });
});
