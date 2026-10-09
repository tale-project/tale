// @vitest-environment node

import { randomJson, seeded } from '@tale/ui/data/random-json';
import { describe, expect, it } from 'vitest';

import type { Automation, NodeDef } from '../types';
import type { Decision, NodeRunRecord, UnitStatus } from './types';
import { recordValue, unlimitedBudget } from './value';
import {
  activeMsOf,
  countsOf,
  glimpseOf,
  GLIMPSE_SHAPE_DEPTH,
  latestPerUnit,
  parentOfPath,
  projectRecord,
  shapeToDepth,
  spanMs,
  viewStatusOf,
  waitedMs,
  type RunFacts,
} from './view';

function row(
  path: string,
  extra: Partial<NodeRunRecord> & { item?: number; pass?: number } = {},
): NodeRunRecord {
  const { item = -1, pass = -1, ...rest } = extra;
  return {
    key: { path, item, pass },
    nodeId: path.slice(path.lastIndexOf('/') + 1),
    nodeType: 'transform',
    status: 'ok',
    activeMs: 1,
    attempt: 1,
    attempts: [],
    decisions: [],
    waits: [],
    meta: {},
    ...rest,
  };
}

const live: RunFacts = { status: 'running', finished: false };
const succeeded: RunFacts = { status: 'success', finished: true };

function when(result: boolean, at: number): Decision {
  return {
    kind: 'when',
    result,
    value: { kind: 'boolean', text: String(result) },
    trace: { pointer: '/nodes/0/when', units: [] },
    at,
  };
}

describe('viewStatusOf', () => {
  it.each<[UnitStatus, RunFacts, string]>([
    ['ok', live, 'succeeded'],
    ['failed', live, 'failed'],
    ['skipped', live, 'skipped'],
    ['running', live, 'running'],
    ['waiting', live, 'waiting'],
    ['ok', succeeded, 'succeeded'],
    ['running', { status: 'cancelled', finished: true }, 'stopped'],
    ['waiting', { status: 'failed', finished: true }, 'stopped'],
  ])('a stored %s step of a %j run reads %s', (status, run, expected) => {
    expect(viewStatusOf(row('a', { status }), run)).toBe(expected);
  });

  it('reads a step with no record by what the run says', () => {
    expect(viewStatusOf(undefined, live, 'a')).toBe('pending');
    expect(viewStatusOf(undefined, { status: 'queued', finished: false })).toBe(
      'pending',
    );
    expect(viewStatusOf(undefined, succeeded, 'a')).toBe('not_run');
    const stopped = { status: 'cancelled', finished: true, failedNode: 'a' };
    expect(viewStatusOf(undefined, stopped, 'a')).toBe('stopped');
    expect(viewStatusOf(undefined, stopped, 'b')).toBe('not_run');
    expect(viewStatusOf(undefined, stopped)).toBe('not_run');
    const failed = { status: 'failed', finished: true, failedNode: 'a' };
    expect(viewStatusOf(undefined, failed, 'a')).toBe('failed');
  });

  it('reads a step taken from an earlier run as reused', () => {
    expect(
      viewStatusOf(row('a', { meta: { reused: { runId: 'r0' } } }), succeeded),
    ).toBe('reused');
  });

  it('reads a step that failed and let the run go on as failed', () => {
    expect(
      viewStatusOf(
        row('a', { status: 'skipped', skip: { reason: 'error' } }),
        succeeded,
      ),
    ).toBe('failed');
  });

  it('reads a status a newer server stores as not known yet', () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a status this reader does not know
    const odd = row('a', { status: 'paused' as UnitStatus });
    expect(viewStatusOf(odd, live)).toBe('pending');
    expect(viewStatusOf(odd, succeeded)).toBe('not_run');
  });
});

describe('times', () => {
  it('spans a unit from start to end, or to now while open', () => {
    expect(spanMs({ startedAt: 10, endedAt: 25 })).toBe(15);
    expect(spanMs({ startedAt: 10 }, 40)).toBe(30);
    expect(spanMs({ startedAt: 10 })).toBeUndefined();
    expect(spanMs({ endedAt: 10 })).toBeUndefined();
    // Two walkers' clocks: an end before the start reads zero.
    expect(spanMs({ startedAt: 30, endedAt: 25 })).toBe(0);
  });

  it('counts waits once, an open wait to now, never past the span', () => {
    const record = {
      startedAt: 0,
      endedAt: 100,
      waits: [
        { kind: 'approval' as const, since: 10, until: 30 },
        { kind: 'repeat' as const, since: 20, until: 40 },
        { kind: 'room' as const, since: 50, until: 45 },
        { kind: 'ask' as const, since: 60 },
      ],
    };
    expect(waitedMs(record)).toBe(30);
    expect(waitedMs(record, 80)).toBe(50);
    expect(waitedMs({ ...record, endedAt: undefined }, 1000)).toBe(970);
    expect(waitedMs({ ...record, endedAt: 35 })).toBe(30);
    expect(waitedMs({ waits: [] })).toBe(0);
  });

  it('reads the time spent working as stored, within sense', () => {
    expect(activeMsOf({ activeMs: 12, startedAt: 0, endedAt: 100 })).toBe(12);
    expect(activeMsOf({ activeMs: 500, startedAt: 0, endedAt: 100 })).toBe(100);
    expect(activeMsOf({ activeMs: -3 })).toBe(0);
    expect(activeMsOf({ activeMs: Number.NaN })).toBe(0);
    expect(activeMsOf({ activeMs: 7 })).toBe(7);
  });
});

describe('countsOf', () => {
  it('takes the counts the step keeps', () => {
    const counts = { items: 500, ok: 499, failed: 1, skipped: 0, kept: 201 };
    expect(countsOf(row('a', { counts }), [row('a', { item: 0 })])).toEqual(
      counts,
    );
  });

  it('counts items from their rows', () => {
    expect(
      countsOf(row('a'), [
        row('a', { item: 0 }),
        row('a', { item: 1, status: 'failed' }),
        row('a', { item: 2, status: 'skipped' }),
        row('a', { item: 4, status: 'running' }),
        // A pass of an item: it says how many items there are, but is no
        // item row itself.
        row('a', { item: 5, pass: 0 }),
      ]),
    ).toEqual({ items: 6, ok: 1, failed: 1, skipped: 1, kept: 4 });
  });

  it('counts passes from their rows', () => {
    expect(
      countsOf(undefined, [row('a', { pass: 0 }), row('a', { pass: 2 })]),
    ).toEqual({ items: 0, ok: 0, failed: 0, skipped: 0, passes: 3, kept: 2 });
  });

  it('says nothing for a step with no items or passes', () => {
    expect(countsOf(row('a'), [])).toBeUndefined();
    expect(countsOf(undefined, [])).toBeUndefined();
  });
});

describe('shapes and glimpses', () => {
  it('keeps a shape to a depth, each level still typed', () => {
    const shape = {
      type: 'object' as const,
      required: ['a'],
      'x-omitted': 2,
      properties: {
        a: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: { b: { type: 'string' as const } },
          },
        },
        c: {
          anyOf: [
            { type: 'string' as const },
            { type: 'object' as const, properties: { d: {} } },
          ],
        },
      },
    };
    expect(shapeToDepth(shape, 0)).toEqual({ type: 'object' });
    expect(shapeToDepth(shape, 1)).toEqual({
      type: 'object',
      required: ['a'],
      'x-omitted': 2,
      properties: {
        a: { type: 'array' },
        c: { anyOf: [{ type: 'string' }, { type: 'object' }] },
      },
    });
    expect(shapeToDepth(shape, 5)).toEqual(shape);
  });

  it('shows a recorded value without the value', () => {
    const record = recordValue(
      {
        token: 'x',
        long: Array.from({ length: 60 }, () => ({ a: { b: { c: { d: 1 } } } })),
      },
      'node',
      unlimitedBudget(),
    );
    const glimpse = glimpseOf(record);
    expect(glimpse).toEqual({
      summary: record.summary,
      shape: shapeToDepth(record.shape, GLIMPSE_SHAPE_DEPTH),
      bytes: record.bytes,
      elided: true,
      redactions: 1,
    });
    expect('value' in glimpse).toBe(false);
    const plain = glimpseOf(recordValue(1, 'node', unlimitedBudget()));
    expect(plain.elided).toBe(false);
    expect(plain.redactions).toBe(0);
  });
});

describe('paths and units', () => {
  it('reads the step that walked a nested step', () => {
    expect(parentOfPath('send')).toBeUndefined();
    expect(parentOfPath('batch[2:0]/send')).toEqual({
      path: 'batch',
      item: 2,
      pass: 0,
    });
    expect(parentOfPath('a[0:1]/b[12:3]/c')).toEqual({
      path: 'a[0:1]/b',
      item: 12,
      pass: 3,
    });
  });

  it('keeps the last record of a unit', () => {
    const first = row('a', { activeMs: 1 });
    const last = row('a', { activeMs: 2 });
    const item = row('a', { item: 0 });
    expect(latestPerUnit([first, item, last])).toEqual([last, item]);
  });
});

describe('projectRecord', () => {
  const nodes: NodeDef[] = [
    // Written out of run order: `report` reads `score`.
    {
      id: 'report',
      type: 'transform',
      input: { s: '{{ nodes.score.output }}' },
      code: 'return 1;',
    },
    {
      id: 'score',
      type: 'transform',
      when: '{{ input.go }}',
      input: { i: '{{ nodes.fetch.output }}' },
      code: 'return 1;',
    },
    {
      id: 'fetch',
      type: 'transform',
      forEach: '{{ input.list }}',
      onError: 'continue',
      code: 'return 1;',
    },
    { id: 'notify', type: 'transform', elseOf: 'score', code: 'return 1;' },
  ];
  const doc: Automation = {
    version: 1,
    name: 'project',
    nodes,
    output: '{{ nodes.report.output }}',
  };

  it('lists the input, the steps in run order, the output, then nested steps', () => {
    const view = projectRecord(
      doc,
      [
        row('batch[1:0]/send', { startedAt: 50 }),
        row('report', { startedAt: 40 }),
        row('__end', { nodeType: 'output', startedAt: 60 }),
        row('score[0:0]/inner', { startedAt: 30 }),
        row('score[0:0]/first', { startedAt: 25 }),
        row('ghost', { startedAt: 1 }),
        row('fetch', { startedAt: 2 }),
        row('__start', { nodeType: 'input', startedAt: 0 }),
        row('score', { startedAt: 20 }),
      ],
      succeeded,
    );
    expect(view.map((n) => n.path)).toEqual([
      '__start',
      'fetch',
      'score',
      'report',
      'notify',
      '__end',
      'score[0:0]/first',
      'score[0:0]/inner',
      'ghost',
      'batch[1:0]/send',
    ]);
    // `score` neither runs per item nor repeats: its path writes 0, its
    // nested steps read -1.
    expect(view.find((n) => n.path === 'score[0:0]/inner')).toMatchObject({
      nodeId: 'inner',
      parentPath: 'score',
      parentItem: -1,
      parentPass: -1,
    });
    const perItem = projectRecord(
      doc,
      [row('fetch[2:0]/send', { startedAt: 5 })],
      succeeded,
    );
    expect(perItem.find((n) => n.path === 'fetch[2:0]/send')).toMatchObject({
      parentPath: 'fetch',
      parentItem: 2,
      parentPass: -1,
    });
    expect(view.find((n) => n.path === 'notify')?.status).toBe('not_run');
  });

  it('follows each skipped step back to its cause', () => {
    const view = projectRecord(
      doc,
      [
        row('fetch', { startedAt: 2 }),
        row('score', {
          status: 'skipped',
          skip: { reason: 'when' },
          decisions: [when(false, 5)],
          startedAt: 4,
          endedAt: 6,
        }),
        row('report', {
          status: 'skipped',
          skip: { reason: 'upstream', via: ['score'] },
          decisions: [{ kind: 'upstream', skipped: ['score'], at: 7 }],
          endedAt: 8,
        }),
        row('notify', { startedAt: 9 }),
      ],
      succeeded,
    );
    const score = view.find((n) => n.path === 'score');
    expect(score?.status).toBe('skipped');
    expect(score?.skip).toEqual({
      reason: 'when',
      at: 5,
      chain: [
        {
          kind: 'when',
          nodeId: 'score',
          path: 'score',
          decision: when(false, 5),
        },
      ],
    });
    expect(score?.decisions).toEqual([
      { ...when(false, 5), source: '{{ input.go }}' },
    ]);
    const report = view.find((n) => n.path === 'report');
    expect(report?.skip).toMatchObject({
      reason: 'upstream',
      via: ['score'],
      at: 7,
    });
    expect(report?.skip?.chain.map((c) => c.kind)).toEqual([
      'upstream',
      'when',
    ]);
    expect(view.find((n) => n.path === 'notify')?.status).toBe('succeeded');
  });

  it('reads a step that failed per item and let the run go on, and counts its items', () => {
    const failure = {
      code: 'node_error',
      reason: 'CODE_FAILED',
      params: {},
      message: 'boom',
    };
    const view = projectRecord(
      doc,
      [
        row('fetch', {
          status: 'failed',
          skip: { reason: 'error' },
          failure,
          decisions: [{ kind: 'onError', policy: 'continue', at: 12 }],
          startedAt: 2,
          endedAt: 13,
        }),
        row('fetch', { item: 0, startedAt: 3 }),
        row('fetch', { item: 1, status: 'failed', failure, startedAt: 5 }),
        row('score', {
          status: 'skipped',
          skip: { reason: 'upstream', via: ['fetch'] },
        }),
      ],
      succeeded,
    );
    expect(view.filter((n) => n.path === 'fetch')).toHaveLength(1);
    const fetch = view.find((n) => n.path === 'fetch');
    expect(fetch).toMatchObject({
      status: 'failed',
      failure,
      skip: {
        reason: 'error',
        at: 12,
        chain: [{ kind: 'error', nodeId: 'fetch', path: 'fetch', failure }],
      },
      counts: { items: 2, ok: 1, failed: 1, skipped: 0, kept: 2 },
    });
    expect(
      view.find((n) => n.path === 'score')?.skip?.chain.map((c) => c.kind),
    ).toEqual(['upstream', 'error']);
  });

  it('names where a failed run ended for every step it never reached', () => {
    const view = projectRecord(
      doc,
      [
        row('__start', { nodeType: 'input' }),
        row('fetch', { status: 'failed', startedAt: 2 }),
      ],
      { status: 'failed', finished: true, failedNode: 'fetch' },
    );
    expect(
      view.map((n) => [n.path, n.status, n.notRun?.stoppedAt ?? null]),
    ).toEqual([
      ['__start', 'succeeded', null],
      ['fetch', 'failed', null],
      ['score', 'not_run', 'fetch'],
      ['report', 'not_run', 'fetch'],
      ['notify', 'not_run', 'fetch'],
      ['__end', 'not_run', 'fetch'],
    ]);
    expect(view[2]?.notRun).toEqual({
      stoppedAt: 'fetch',
      runStatus: 'failed',
    });
  });

  it('reads a live run: what is still to come is pending, the running step runs', () => {
    const view = projectRecord(
      doc,
      [
        row('__start', { nodeType: 'input' }),
        row('fetch', {
          status: 'waiting',
          startedAt: 0,
          waits: [{ kind: 'approval', since: 10 }],
        }),
      ],
      { status: 'waiting', finished: false, now: 70 },
    );
    expect(view.map((n) => n.status)).toEqual([
      'succeeded',
      'waiting',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(view[1]?.waitedMs).toBe(60);
    expect(view[1]?.notRun).toBeUndefined();
  });

  it('reads a cancelled run: the step it stopped in was stopped', () => {
    const view = projectRecord(
      doc,
      [row('fetch', { status: 'running', startedAt: 0 })],
      { status: 'cancelled', finished: true, failedNode: 'fetch' },
    );
    expect(view.map((n) => n.status)).toEqual([
      'succeeded',
      'stopped',
      'not_run',
      'not_run',
      'not_run',
      'not_run',
    ]);
    expect(view[2]?.notRun).toEqual({
      stoppedAt: 'fetch',
      runStatus: 'cancelled',
    });
  });

  it('measures what was still open when the run ended to its end, never to the reading', () => {
    const records = [
      row('fetch', {
        status: 'waiting',
        startedAt: 0,
        waits: [{ kind: 'approval', since: 10 }],
      }),
    ];
    const facts = {
      status: 'cancelled',
      finished: true,
      failedNode: 'fetch',
      finishedAt: 100,
    };
    const early = projectRecord(doc, records, { ...facts, now: 1_000 });
    const late = projectRecord(doc, records, { ...facts, now: 9_000_000 });
    const fetchOf = (view: typeof early) =>
      view.find((n) => n.path === 'fetch');
    expect(fetchOf(early)?.waitedMs).toBe(90);
    expect(fetchOf(late)?.waitedMs).toBe(90);
  });

  it('reads an in-process run that failed, which says error, as failed', () => {
    const view = projectRecord(
      doc,
      [row('fetch', { status: 'failed', startedAt: 0 })],
      { status: 'error', finished: true, failedNode: 'fetch' },
    );
    const notReached = view.find((n) => n.path === 'report');
    expect(notReached?.status).toBe('not_run');
    expect(notReached?.notRun).toEqual({
      stoppedAt: 'fetch',
      runStatus: 'failed',
    });
  });

  it('completes the input and the output a record does not hold', () => {
    const queued = projectRecord(doc, [], {
      status: 'queued',
      finished: false,
    });
    expect([queued[0]?.status, queued.at(-1)?.status]).toEqual([
      'pending',
      'pending',
    ]);
    const done = projectRecord(doc, [], succeeded);
    expect([done[0]?.status, done.at(-1)?.status]).toEqual([
      'succeeded',
      'succeeded',
    ]);
    expect(done[0]).toMatchObject({ nodeId: '__start', type: 'input' });
    expect(done.at(-1)).toMatchObject({ nodeId: '__end', type: 'output' });
    const failedAtEnd = projectRecord(doc, [], {
      status: 'failed',
      finished: true,
      failedNode: '__end',
    });
    expect(failedAtEnd.at(-1)?.status).toBe('failed');
  });

  it('reads a step whose own record is missing from its items', () => {
    const view = projectRecord(
      doc,
      [row('fetch', { item: 0 }), row('fetch', { item: 1, status: 'running' })],
      live,
    );
    expect(view[1]).toMatchObject({
      path: 'fetch',
      status: 'running',
      counts: { items: 2, ok: 1, kept: 2 },
    });
    const done = projectRecord(doc, [row('fetch', { item: 0 })], succeeded);
    expect(done[1]?.status).toBe('succeeded');
    const failed = projectRecord(
      doc,
      [row('fetch', { item: 0, status: 'failed' })],
      succeeded,
    );
    expect(failed[1]?.status).toBe('failed');
    const cut = projectRecord(
      doc,
      [row('fetch', { item: 0, status: 'running' })],
      succeeded,
    );
    expect(cut[1]?.status).toBe('stopped');
  });

  it('shows values as glimpses, and only the meta a summary carries', () => {
    const input = recordValue(
      { apiKey: 'k', q: 'x' },
      'node',
      unlimitedBudget(),
    );
    const view = projectRecord(
      doc,
      [
        row('fetch', {
          input,
          output: recordValue([1, 2], 'node', unlimitedBudget()),
          meta: {
            model: 'm',
            connector: 'c',
            idempotencyKey: 'run:fetch:0',
            approvalId: 'ap',
            reused: { runId: 'r0', startedAt: 1 },
            pins: { child: 3 },
          },
        }),
      ],
      succeeded,
    );
    const fetch = view[1];
    expect(fetch?.status).toBe('reused');
    expect(fetch?.reused).toEqual({ runId: 'r0' });
    expect(fetch?.meta).toEqual({
      model: 'm',
      connector: 'c',
      pins: { child: 3 },
    });
    expect(fetch?.input).toEqual(glimpseOf(input));
    expect(fetch?.input?.redactions).toBe(1);
    expect(JSON.stringify(view)).not.toContain('"value":');
  });

  it('falls back to the written order for a document whose steps loop', () => {
    const loop: Automation = {
      version: 1,
      name: 'loop',
      nodes: [
        {
          id: 'a',
          type: 'transform',
          input: { b: '{{ nodes.b.output }}' },
          code: 'return 1;',
        },
        {
          id: 'b',
          type: 'transform',
          input: { a: '{{ nodes.a.output }}' },
          code: 'return 1;',
        },
        { id: 'a', type: 'transform', code: 'return 2;' },
      ],
    };
    expect(projectRecord(loop, [], succeeded).map((n) => n.path)).toEqual([
      '__start',
      'a',
      'b',
      '__end',
    ]);
  });

  it('never loses a record, never shows a value, and keeps the frame on any records [seeded]', () => {
    const random = seeded(20261009);
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const statuses: UnitStatus[] = [
      'ok',
      'failed',
      'skipped',
      'running',
      'waiting',
    ];
    const reasons = ['when', 'else', 'upstream', 'error'] as const;
    const pick = <T>(xs: readonly T[]): T =>
      xs[Math.floor(random() * xs.length)] as T;
    for (let run = 0; run < 200; run++) {
      const docNodes: NodeDef[] = ids
        .filter(() => random() < 0.8)
        .map((id, i, kept) => {
          const node: NodeDef = { id, type: 'transform', code: 'return 1;' };
          if (i > 0 && random() < 0.5) {
            node.input = { v: `{{ nodes.${pick(kept.slice(0, i))}.output }}` };
          }
          if (random() < 0.3) node.forEach = '{{ input.list }}';
          return node;
        });
      const paths = [...ids, '__start', '__end', 'a[0:0]/x', 'zz'];
      const records: NodeRunRecord[] = Array.from(
        { length: Math.floor(random() * 12) },
        () => {
          const status = pick(statuses);
          return row(pick(paths), {
            status,
            item: random() < 0.2 ? Math.floor(random() * 3) : -1,
            startedAt: Math.floor(random() * 100),
            ...(status === 'skipped' && {
              skip: {
                reason: pick(reasons),
                // Any step, itself included: malformed records loop.
                via: [pick(ids)],
              },
            }),
            output: recordValue(
              randomJson(random, 3),
              'node',
              unlimitedBudget(),
            ),
          });
        },
      );
      const facts: RunFacts = pick([
        live,
        succeeded,
        { status: 'failed', finished: true, failedNode: pick(ids) },
        { status: 'cancelled', finished: true },
      ]);
      const view = projectRecord(
        { version: 1, name: 'x', nodes: docNodes },
        records,
        facts,
      );
      const listed = view.map((n) => n.path);
      expect(new Set(listed).size).toBe(listed.length);
      expect(listed[0]).toBe('__start');
      expect(listed[docNodes.length + 1]).toBe('__end');
      for (const node of docNodes) expect(listed).toContain(node.id);
      for (const record of records) expect(listed).toContain(record.key.path);
      for (const summary of view) {
        expect(summary.skip?.chain.length ?? 0).toBeLessThanOrEqual(
          paths.length,
        );
      }
      expect(JSON.stringify(view)).not.toContain('"value":');
    }
  });
});
