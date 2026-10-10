// @vitest-environment node

import { randomJson, seeded } from '@tale/ui/data/random-json';
import { summaryOf } from '@tale/ui/data/value-summary';
import { describe, expect, it } from 'vitest';

import type { Automation, NodeDef } from '../types';
import {
  MAX_TRAVELS,
  deriveTravels,
  walkRecorded,
  type Travel,
} from './travels';
import type { Decision, NodeRunRecord } from './types';
import { recordValue, unlimitedBudget } from './value';

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

const stored = (value: unknown) =>
  recordValue(value, 'node', unlimitedBudget());

function when(result: boolean, at: number): Decision {
  return {
    kind: 'when',
    result,
    value: { kind: 'boolean', text: String(result) },
    trace: { pointer: '', units: [] },
    at,
  };
}

function doc(nodes: NodeDef[], output?: unknown): Automation {
  return { version: 1, name: 'travels', nodes, output };
}

/** The parts of a travel a test reads at a glance. */
function brief(t: Travel) {
  return {
    edge: `${t.edge.source}>${t.edge.target}:${t.edge.kind}`,
    field: t.to.field,
    refPath: t.refPath,
    at: t.at,
    ...(t.item !== undefined && { item: t.item }),
    ...(t.pass !== undefined && { pass: t.pass }),
  };
}

const issues = [
  { id: 1, title: 'Login fails' },
  { id: 2, title: 'Slow search' },
  { id: 3, title: 'Typo' },
];

describe('deriveTravels', () => {
  const triage = doc(
    [
      { id: 'fetch', type: 'transform', code: 'return { issues: [] };' },
      {
        id: 'score',
        type: 'transform',
        when: '{{ input.go }}',
        input: { list: '{{ nodes.fetch.output.issues }}' },
        code: 'return { total: input.list.length };',
      },
    ],
    { total: '{{ nodes.score.output.total }}', who: '{{ input.owner }}' },
  );
  const runInput = { go: true, owner: 'Ada' };

  it('carries each read from its source at the moment it was read', () => {
    // As a recorder stamps them: a step starts, then its condition decides.
    const { travels, total } = deriveTravels(triage, [
      row('__start', { startedAt: 0, output: stored(runInput) }),
      row('fetch', { startedAt: 1, output: stored({ issues }) }),
      row('score', {
        startedAt: 5,
        decisions: [when(true, 6)],
        output: stored({ total: 3 }),
      }),
      row('__end', { startedAt: 9 }),
    ]);
    expect(total).toBe(4);
    expect(travels.map(brief)).toEqual([
      {
        edge: '__start>score:order',
        field: 'when',
        refPath: ['go'],
        at: 6,
      },
      // Read once the condition let the step through, never before.
      {
        edge: 'fetch>score:data',
        field: 'input',
        refPath: ['issues'],
        at: 6,
      },
      {
        edge: 'score>__end:data',
        field: 'output',
        refPath: ['total'],
        at: 9,
      },
      {
        edge: '__start>__end:entry',
        field: 'output',
        refPath: ['owner'],
        at: 9,
      },
    ]);
    expect(travels[0].from).toEqual({ kind: 'input' });
    expect(travels[0].value).toEqual(summaryOf(true));
    expect(travels[1].from).toEqual({ kind: 'node', nodeId: 'fetch' });
    expect(travels[1].value).toEqual(summaryOf(issues));
    expect(travels[1].to).toEqual({
      path: 'score',
      field: 'input',
      pointer: '/nodes/1/input/list',
      range: [3, 28],
    });
    expect(travels[2].value).toEqual(summaryOf(3));
    expect(travels[3].value).toEqual(summaryOf('Ada'));
  });

  it('reads a step’s data after its condition however the times tie', () => {
    const { travels } = deriveTravels(triage, [
      row('fetch', { startedAt: 1, output: stored({ issues }) }),
      row('score', { startedAt: 6, decisions: [when(true, 6)] }),
    ]);
    expect(travels.map((t) => [t.edge.kind, t.at])).toEqual([
      ['order', 6],
      ['data', 6],
    ]);
  });

  describe('a step whose condition failed to evaluate', () => {
    const guarded = doc([
      { id: 'fetch', type: 'transform', code: 'return { v: 1 };' },
      {
        id: 'a',
        type: 'transform',
        when: '{{ input.x.y.z }}',
        onError: 'continue',
        input: { v: '{{ nodes.fetch.output.v }}' },
        code: 'return 1;',
      },
      {
        id: 'each',
        type: 'transform',
        when: '{{ input.x.y.z }}',
        forEach: '{{ nodes.fetch.output.list }}',
        input: { v: '{{ item }}' },
        code: 'return 1;',
      },
    ]);
    const failure = (index: number, at = `/nodes/${index}/when`) => ({
      code: 'node_error',
      reason: 'EXPR_READ_MISSING',
      params: {},
      message: "Cannot read properties of undefined (reading 'y')",
      at: { pointer: at, range: [3, 14] as [number, number] },
    });

    it('carries the condition it read, when it failed, and nothing else', () => {
      // The record the executor keeps: no `when` decision, the failure at
      // the condition, then the run going on without the step.
      const { travels, total } = deriveTravels(guarded, [
        row('__start', { startedAt: 10, output: stored({}) }),
        row('fetch', { startedAt: 30, output: stored({ v: 1, list: [1] }) }),
        row('a', {
          status: 'skipped',
          skip: { reason: 'error' },
          startedAt: 50,
          endedAt: 70,
          decisions: [{ kind: 'onError', policy: 'continue', at: 60 }],
          failure: failure(1),
        }),
      ]);
      expect(total).toBe(1);
      expect(travels.map(brief)).toEqual([
        {
          edge: '__start>a:order',
          field: 'when',
          refPath: ['x', 'y', 'z'],
          at: 60,
        },
      ]);
    });

    it('carries no list into a step that runs per item, and ends the run', () => {
      const { travels } = deriveTravels(guarded, [
        row('fetch', { startedAt: 30, output: stored({ v: 1, list: [1] }) }),
        row('each', {
          status: 'failed',
          startedAt: 50,
          endedAt: 70,
          failure: failure(2),
        }),
      ]);
      expect(travels.map(brief)).toEqual([
        {
          edge: '__start>each:order',
          field: 'when',
          refPath: ['x', 'y', 'z'],
          at: 70,
        },
      ]);
    });

    it('still carries the reads of a step that failed in a field named like a condition', () => {
      const { travels } = deriveTravels(guarded, [
        row('fetch', { startedAt: 30, output: stored({ v: 1 }) }),
        row('a', {
          status: 'skipped',
          skip: { reason: 'error' },
          startedAt: 50,
          decisions: [
            when(true, 55),
            { kind: 'onError', policy: 'continue', at: 60 },
          ],
          failure: failure(1, '/nodes/1/input/when'),
        }),
      ]);
      expect(travels.map((t) => t.edge.kind)).toEqual(['order', 'data']);
    });
  });

  it('carries a condition read into a step its condition then skipped, and nothing else', () => {
    const { travels } = deriveTravels(triage, [
      row('__start', { startedAt: 0, output: stored({ go: false }) }),
      row('fetch', { startedAt: 1, output: stored({ issues }) }),
      row('score', {
        status: 'skipped',
        skip: { reason: 'when' },
        startedAt: 6,
        decisions: [when(false, 5)],
      }),
    ]);
    expect(travels.map(brief)).toEqual([
      { edge: '__start>score:order', field: 'when', refPath: ['go'], at: 5 },
    ]);
    expect(travels[0].value).toEqual(summaryOf(false));
  });

  it('carries nothing into a step skipped before it read anything', () => {
    const { travels, total } = deriveTravels(triage, [
      row('fetch', { status: 'skipped', skip: { reason: 'when' } }),
      row('score', {
        status: 'skipped',
        skip: { reason: 'upstream', via: ['fetch'] },
        startedAt: 6,
      }),
    ]);
    expect(travels).toEqual([]);
    expect(total).toBe(0);
  });

  it('carries what a step read before it failed and the run went on', () => {
    const { travels } = deriveTravels(triage, [
      row('fetch', { startedAt: 1, output: stored({ issues }) }),
      row('score', {
        status: 'failed',
        skip: { reason: 'error' },
        startedAt: 6,
        decisions: [
          when(true, 5),
          { kind: 'onError', policy: 'continue', at: 7 },
        ],
      }),
    ]);
    expect(travels.map((t) => t.edge.kind)).toEqual(['order', 'data']);
  });

  it('reads the list of a step that runs per item once, and each item per item', () => {
    const perItem = doc([
      { id: 'fetch', type: 'transform', code: 'return { issues: [] };' },
      {
        id: 'label',
        type: 'transform',
        forEach: '{{ nodes.fetch.output.issues }}',
        input: { title: '{{ item.title }}', at: '{{ index }}' },
        code: 'return input.title;',
      },
    ]);
    const { travels } = deriveTravels(perItem, [
      row('fetch', { startedAt: 1, output: stored({ issues }) }),
      row('label', {
        startedAt: 3,
        decisions: [
          {
            kind: 'forEach',
            count: 3,
            value: summaryOf(issues),
            trace: { pointer: '', units: [] },
            at: 4,
          },
        ],
      }),
      ...issues.map((_, i) => row('label', { item: i, startedAt: 10 + i })),
    ]);
    expect(travels.map(brief)).toEqual([
      {
        edge: 'fetch>label:data',
        field: 'forEach',
        refPath: ['issues'],
        at: 4,
      },
      ...issues.map((_, i) => ({
        edge: 'fetch>label:data',
        field: 'input',
        refPath: ['issues', i, 'title'],
        at: 10 + i,
        item: i,
      })),
    ]);
    expect(travels.slice(1).map((t) => t.value)).toEqual(
      issues.map((issue) => summaryOf(issue.title)),
    );
  });

  it('says no source for an item of a list the step computes', () => {
    const computed = doc([
      { id: 'fetch', type: 'transform', code: 'return { issues: [] };' },
      {
        id: 'label',
        type: 'transform',
        forEach: '{{ nodes.fetch.output.issues.filter((i) => i.id > 1) }}',
        input: { title: '{{ item.title }}' },
        code: 'return input.title;',
      },
    ]);
    const { travels } = deriveTravels(computed, [
      row('fetch', { startedAt: 1, output: stored({ issues }) }),
      row('label', { startedAt: 3 }),
      row('label', { item: 0, startedAt: 10 }),
    ]);
    // The list read carries the method's receiver; the item comes from no
    // step.
    expect(travels.map(brief)).toEqual([
      {
        edge: 'fetch>label:data',
        field: 'forEach',
        refPath: ['issues'],
        at: 3,
      },
    ]);
  });

  it('reads per pass for a step that repeats, and per pass of each item when it also runs per item', () => {
    const repeating = doc([
      { id: 'fetch', type: 'transform', code: 'return { page: 1 };' },
      {
        id: 'poll',
        type: 'transform',
        repeatUntil: '{{ output.done }}',
        input: { page: '{{ nodes.fetch.output.page }}' },
        code: 'return { done: true };',
      },
      {
        id: 'each',
        type: 'transform',
        forEach: '{{ input.list }}',
        repeatUntil: '{{ output }}',
        input: { page: '{{ nodes.fetch.output.page }}' },
        code: 'return true;',
      },
    ]);
    const { travels } = deriveTravels(repeating, [
      row('fetch', { startedAt: 1, output: stored({ page: 1 }) }),
      row('poll', { startedAt: 2 }),
      row('poll', { pass: 0, startedAt: 3 }),
      row('poll', { pass: 1, startedAt: 4 }),
      row('each', { startedAt: 5 }),
      row('each', { item: 0, startedAt: 6 }),
      row('each', { item: 0, pass: 0, startedAt: 7 }),
      row('each', { item: 0, pass: 1, startedAt: 8 }),
    ]);
    expect(travels.map(brief)).toEqual([
      {
        edge: 'fetch>poll:data',
        field: 'input',
        refPath: ['page'],
        at: 3,
        pass: 0,
      },
      {
        edge: 'fetch>poll:data',
        field: 'input',
        refPath: ['page'],
        at: 4,
        pass: 1,
      },
      {
        edge: '__start>each:entry',
        field: 'forEach',
        refPath: ['list'],
        at: 5,
      },
      {
        edge: 'fetch>each:data',
        field: 'input',
        refPath: ['page'],
        at: 7,
        item: 0,
        pass: 0,
      },
      {
        edge: 'fetch>each:data',
        field: 'input',
        refPath: ['page'],
        at: 8,
        item: 0,
        pass: 1,
      },
    ]);
  });

  it('carries what a repeating step’s settling condition reads into each pass it settled', () => {
    const settling = doc([
      { id: 'limit', type: 'transform', code: 'return { n: 2 };' },
      {
        id: 'poll',
        type: 'transform',
        repeatUntil:
          '{{ output.n >= nodes.limit.output.n && nodes.poll.output.n > 0 }}',
        code: 'return { n: 1 };',
      },
    ]);
    const settled = (pass: number, result: boolean, at: number): Decision => ({
      kind: 'repeatUntil',
      pass,
      result,
      capped: false,
      value: { kind: 'boolean', text: String(result) },
      trace: { pointer: '/nodes/1/repeatUntil', units: [] },
      at,
    });
    const { travels } = deriveTravels(settling, [
      row('limit', { startedAt: 1, output: stored({ n: 2 }) }),
      row('poll', { startedAt: 2 }),
      row('poll', { pass: 0, startedAt: 3, decisions: [settled(0, false, 4)] }),
      row('poll', { pass: 1, startedAt: 5, decisions: [settled(1, true, 6)] }),
      // A pass that failed before its check settled nothing.
      row('poll', { pass: 2, startedAt: 7, status: 'failed' }),
    ]);
    // Its own output (`output`, `nodes.poll.output`) comes from no other
    // step.
    expect(travels.map(brief)).toEqual([
      {
        edge: 'limit>poll:order',
        field: 'repeatUntil',
        refPath: ['n'],
        at: 4,
        pass: 0,
      },
      {
        edge: 'limit>poll:order',
        field: 'repeatUntil',
        refPath: ['n'],
        at: 6,
        pass: 1,
      },
    ]);
    expect(travels[0].value).toEqual(summaryOf(2));
  });

  it('reads references in a transform body, dropping a called method', () => {
    const body = doc([
      { id: 'fetch', type: 'transform', code: 'return { issues: [] };' },
      {
        id: 'count',
        type: 'transform',
        code: 'return nodes.fetch.output.issues.length + nodes.fetch.output.issues.map((i) => i.id).length;',
      },
    ]);
    const { travels } = deriveTravels(body, [
      row('fetch', { startedAt: 1, output: stored({ issues }) }),
      row('count', { startedAt: 2 }),
    ]);
    expect(travels.map((t) => [t.to.field, t.refPath, t.value])).toEqual([
      ['code', ['issues', 'length'], summaryOf(3)],
      ['code', ['issues'], summaryOf(issues)],
    ]);
  });

  it('carries no value for a read that is not of the output, and no travel for a dynamic one', () => {
    const odd = doc([
      { id: 'fetch', type: 'transform', code: 'return 1;' },
      {
        id: 'b',
        type: 'transform',
        input: { all: '{{ nodes.fetch }}', any: "{{ nodes['fe' + 'tch'] }}" },
        code: 'return 1;',
      },
    ]);
    const { travels } = deriveTravels(odd, [
      row('fetch', { startedAt: 1, output: stored(1) }),
      row('b', { startedAt: 2 }),
    ]);
    expect(travels.map(brief)).toEqual([
      { edge: 'fetch>b:data', field: 'input', refPath: [], at: 2 },
    ]);
    expect(travels[0].value).toBeUndefined();
  });

  it('carries nothing into a step reused from an earlier run, a step inside a subautomation, or a step with no start', () => {
    const { travels } = deriveTravels(triage, [
      row('fetch', { startedAt: 1, output: stored({ issues }) }),
      row('score', {
        startedAt: 6,
        decisions: [when(true, 5)],
        meta: { reused: { runId: 'run-0' } },
      }),
      row('score[0:0]/inner', { startedAt: 7 }),
      row('__end'),
    ]);
    expect(travels).toEqual([]);
  });

  it('reads values from the stored output a step reused from an earlier run kept', () => {
    const { travels } = deriveTravels(triage, [
      row('fetch', {
        output: stored({ issues }),
        meta: { reused: { runId: 'run-0' } },
      }),
      row('score', { startedAt: 6 }),
    ]);
    expect(travels[0].value).toEqual(summaryOf(issues));
  });

  it('takes the last of two records for one unit', () => {
    const { travels } = deriveTravels(triage, [
      row('fetch', { startedAt: 1, output: stored({ issues: [] }) }),
      row('fetch', { startedAt: 1, output: stored({ issues }) }),
      row('score', { startedAt: 6 }),
    ]);
    expect(travels[0].value).toEqual(summaryOf(issues));
  });

  it('keeps the earliest travels within the cap and counts the rest', () => {
    const wide = doc([
      { id: 'fetch', type: 'transform', code: 'return 1;' },
      {
        id: 'each',
        type: 'transform',
        forEach: '{{ input.list }}',
        input: { a: '{{ nodes.fetch.output }}', b: '{{ item }}' },
        code: 'return 1;',
      },
    ]);
    const items = 700;
    const records = [
      row('__start', { startedAt: 0, output: stored({ list: [] }) }),
      row('fetch', { startedAt: 1, output: stored(1) }),
      row('each', { startedAt: 2 }),
      // Stored out of time order: the cap keeps the earliest reads.
      ...Array.from({ length: items }, (_, i) =>
        row('each', { item: items - 1 - i, startedAt: 10 + items - 1 - i }),
      ),
    ];
    const { travels, total } = deriveTravels(wide, records);
    expect(total).toBe(1 + items * 2);
    expect(travels).toHaveLength(MAX_TRAVELS);
    expect(travels[0].to.field).toBe('forEach');
    const times = travels.map((t) => t.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // The list read first, then two reads per item.
    expect(travels.at(-1)?.item).toBe((MAX_TRAVELS - 2) / 2);
  });

  describe('bounds its work to the travels it keeps', () => {
    // Each read costs a few objects; a run with millions of reads must not
    // build them all to keep the first thousand.
    function perItem(refs: number, items: number) {
      const prompt = Array.from(
        { length: refs },
        (_, i) => `{{ nodes.fetch.output.k${i} }}`,
      ).join(' ');
      const automation = doc([
        { id: 'fetch', type: 'transform', code: 'return {};' },
        {
          id: 'each',
          type: 'llm',
          forEach: '{{ nodes.fetch.output.list }}',
          prompt: `{{ item.title }} ${prompt}`,
        },
      ]);
      const records = [
        row('fetch', {
          startedAt: 1,
          output: stored({ list: issues, k0: 'v' }),
        }),
        row('each', { startedAt: 2 }),
        ...Array.from({ length: items }, (_, i) =>
          row('each', { item: items - 1 - i, startedAt: 10 + items - 1 - i }),
        ),
      ];
      return { automation, records };
    }

    it('answers ten thousand items of five reads each at once', () => {
      const { automation, records } = perItem(4, 10_000);
      deriveTravels(automation, records);
      const started = performance.now();
      const { travels, total } = deriveTravels(automation, records);
      const ms = performance.now() - started;
      expect(total).toBe(1 + 10_000 * 5);
      expect(travels).toHaveLength(MAX_TRAVELS);
      expect(travels.at(-1)).toMatchObject({ item: 199, at: 10 + 199 });
      expect(ms).toBeLessThan(50);
    });

    it('counts two million reads without building them', () => {
      const { automation, records } = perItem(1999, 1000);
      const started = performance.now();
      const { travels, total } = deriveTravels(automation, records);
      const ms = performance.now() - started;
      expect(total).toBe(1 + 1000 * 2000);
      expect(travels).toHaveLength(MAX_TRAVELS);
      // The list, then the first item's two thousand reads, cut.
      expect(travels.every((t) => t.item === undefined || t.item === 0)).toBe(
        true,
      );
      expect(travels[1]?.value).toEqual(summaryOf(issues[0].title));
      expect(travels[2]?.value).toEqual(summaryOf('v'));
      expect(ms).toBeLessThan(250);
    });
  });

  it('carries nothing for a document whose steps the records do not name', () => {
    expect(
      deriveTravels(triage, [row('ghost', { startedAt: 1 })]).travels,
    ).toEqual([]);
    expect(deriveTravels(doc([]), []).travels).toEqual([]);
  });
});

describe('walkRecorded', () => {
  it('reads nothing when the value was not stored', () => {
    expect(walkRecorded(undefined, [])).toBeUndefined();
    const spent = recordValue({ a: 1 }, 'node', { left: 0 });
    expect(spent.value).toBeUndefined();
    expect(walkRecorded(spent, ['a'])).toBeUndefined();
  });

  it('reads a path through objects and lists', () => {
    const record = stored({ issues });
    expect(walkRecorded(record, [])).toEqual(summaryOf({ issues }));
    expect(walkRecorded(record, ['issues', 1, 'title'])).toEqual(
      summaryOf('Slow search'),
    );
    expect(walkRecorded(record, ['issues', '2', 'id'])).toEqual(summaryOf(3));
    expect(walkRecorded(record, ['issues', 'length'])).toEqual(summaryOf(3));
  });

  it('reads nothing where the path leads out of the value', () => {
    const record = stored({ issues, name: 'x' });
    expect(walkRecorded(record, ['missing'])).toBeUndefined();
    expect(walkRecorded(record, ['issues', 7])).toBeUndefined();
    expect(walkRecorded(record, ['issues', 'first'])).toBeUndefined();
    expect(walkRecorded(record, ['issues', -1])).toBeUndefined();
    expect(walkRecorded(record, ['name', 'x'])).toBeUndefined();
    expect(walkRecorded(record, ['issues', 'length', 'x'])).toBeUndefined();
    // An inherited member is no member of the value.
    expect(walkRecorded(record, ['toString'])).toBeUndefined();
  });

  it('says a withheld secret is withheld, at it and below it', () => {
    const record = stored({ password: 'hunter2', nested: { apiKey: 'k' } });
    expect(walkRecorded(record, ['password'])).toEqual({ kind: 'redacted' });
    expect(walkRecorded(record, ['nested', 'apiKey', 'x'])).toEqual({
      kind: 'redacted',
    });
    const list = stored(['sk-live-abcdefghijklmnopqrstuvwxyz123456', 'ok']);
    expect(walkRecorded(list, [])?.items?.[0]).toEqual({ kind: 'redacted' });
  });

  it('tells a list cut short at its whole length, and an item past the cut as cut', () => {
    const long = Array.from({ length: 60 }, (_, i) => i);
    const record = stored({ long });
    expect(record.elided).toEqual([
      { pointer: '/long', kind: 'items', dropped: 10 },
    ]);
    const summary = walkRecorded(record, ['long']);
    expect(summary?.length).toBe(60);
    expect(summary?.bytes).toBeUndefined();
    expect(walkRecorded(record, ['long', 'length'])).toEqual(summaryOf(60));
    expect(walkRecorded(record, ['long', 49])).toEqual(summaryOf(49));
    expect(walkRecorded(record, ['long', 55])).toEqual({ kind: 'elided' });
    expect(walkRecorded(record, ['long', 60])).toBeUndefined();
  });

  it('tells a text cut short at its whole length, and as cut', () => {
    const text = 'x'.repeat(5000);
    const record = stored({ text, list: [text] });
    const summary = walkRecorded(record, ['text']);
    expect(summary?.length).toBe(5000);
    expect(summary?.cut).toBe(true);
    expect(walkRecorded(record, ['text', 'length'])).toEqual(summaryOf(5000));
    expect(walkRecorded(record, ['list'])?.items?.[0]).toMatchObject({
      kind: 'string',
      length: 5000,
      cut: true,
    });
  });

  it('says a value past the depth kept is cut', () => {
    let deep: unknown = 'bottom';
    for (let i = 0; i < 14; i++) deep = { d: deep };
    const record = stored(deep);
    const path = Array.from({ length: 13 }, () => 'd');
    expect(walkRecorded(record, path)).toEqual({ kind: 'elided' });
    expect(walkRecorded(record, path.slice(0, 2))?.bytes).toBeUndefined();
  });

  it('reads a value too large to keep as cut', () => {
    const record = recordValue(
      Array.from({ length: 50 }, () => 'y'.repeat(4000)),
      'node',
      unlimitedBudget(),
    );
    expect(record.elided).toEqual([
      expect.objectContaining({ pointer: '', kind: 'whole' }),
    ]);
    expect(walkRecorded(record, [])).toEqual({ kind: 'elided' });
    expect(walkRecorded(record, [0])).toEqual({ kind: 'elided' });
  });

  it('answers no lengths or sizes when the record could not list every cut', () => {
    // More cuts than a record lists: each deep member is cut at the depth
    // kept.
    let deep: unknown = 'bottom';
    for (let i = 0; i < 12; i++) deep = { d: deep };
    const record = stored({
      list: Array.from({ length: 60 }, (_, i) => i),
      ...Object.fromEntries(
        Array.from({ length: 120 }, (_, i) => [`k${i}`, deep]),
      ),
    });
    expect(record.elidedTotal).toBeDefined();
    const summary = walkRecorded(record, ['list']);
    expect(summary?.kind).toBe('array');
    expect(summary?.length).toBeUndefined();
    expect(summary?.bytes).toBeUndefined();
    expect(walkRecorded(record, ['list', 'length'])).toBeUndefined();
  });

  it('agrees with a summary of the value itself wherever nothing was cut [seeded]', () => {
    const random = seeded(20261009);
    for (let run = 0; run < 300; run++) {
      const value = randomJson(random, 4);
      const record = stored(value);
      if (record.elided !== undefined || record.redacted !== undefined) {
        continue;
      }
      // Walk every path the stored value has.
      const visit = (at: unknown, path: Array<string | number>): void => {
        expect(walkRecorded(record, path)).toEqual(summaryOf(at));
        if (Array.isArray(at)) {
          at.forEach((item, i) => visit(item, [...path, i]));
        } else if (typeof at === 'object' && at !== null) {
          for (const [key, item] of Object.entries(at)) {
            visit(item, [...path, key]);
          }
        }
      };
      visit(record.value, []);
    }
  });
});
