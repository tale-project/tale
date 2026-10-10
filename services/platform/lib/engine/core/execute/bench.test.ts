// @vitest-environment node

import { describe, expect, it } from 'vitest';

import type { NodeDef } from '../types';
import {
  ancestorsOf,
  benchFromTest,
  itemOutOfRange,
  planBench,
  refusalIssue,
  refusalPath,
} from './bench';

/** fetch → score → report, with an alternative to report and a node that
 * reads nothing. */
const NODES: NodeDef[] = [
  { id: 'fetch', type: 'transform', code: 'return [1, 2];' },
  {
    id: 'score',
    type: 'transform',
    forEach: '{{ nodes.fetch.output }}',
    input: { n: '{{ item }}' },
    code: 'return input.n * 2;',
  },
  {
    id: 'report',
    type: 'transform',
    when: '{{ nodes.score.output.length > 0 }}',
    input: { scores: '{{ nodes.score.output }}' },
    code: 'return input.scores;',
  },
  {
    id: 'nothing',
    type: 'transform',
    elseOf: 'report',
    code: 'return [];',
  },
  { id: 'clock', type: 'transform', code: 'return Date.now();' },
];

function refused(bench: Parameters<typeof planBench>[1]) {
  const planned = planBench(NODES, bench);
  if (planned.ok) throw new Error('expected a refusal');
  return planned;
}

describe('planBench — refusals, in the words agents read', () => {
  it('a stand-in for a node the automation does not have, with the closest', () => {
    expect(refused({ mocks: { fetchh: [] } })).toEqual({
      ok: false,
      refusal: {
        code: 'BENCH_UNKNOWN_NODE',
        field: 'mocks',
        node: 'fetchh',
        suggestion: 'fetch',
      },
      message:
        'the test simulates "fetchh", which is not a node of this automation',
      hint: 'did you mean "fetch"? nodes: fetch, score, report, nothing, clock',
    });
    expect(refused({ failures: { zzz: 'down' } })).toMatchObject({
      refusal: { code: 'BENCH_UNKNOWN_NODE', field: 'failures', node: 'zzz' },
      hint: 'nodes: fetch, score, report, nothing, clock',
    });
  });

  it('a scope naming a node the automation does not have', () => {
    expect(refused({ upTo: 'reprot' })).toMatchObject({
      refusal: {
        code: 'BENCH_UNKNOWN_NODE',
        field: 'upTo',
        node: 'reprot',
      },
      message: 'upTo names "reprot", which is not a node of this automation',
    });
    expect(refused({ only: 'x' }).message).toBe(
      'only names "x", which is not a node of this automation',
    );
  });

  it('both an output and a failure for one node', () => {
    expect(
      refused({ mocks: { fetch: [] }, failures: { fetch: 'down' } }),
    ).toEqual({
      ok: false,
      refusal: { code: 'BENCH_CONFLICT', node: 'fetch' },
      message: 'the test both simulates an output and a failure for "fetch"',
      hint: 'keep one of mocks.fetch and failures.fetch',
    });
  });

  it('scopes that do not combine', () => {
    expect(refused({ upTo: 'report', only: 'report' })).toEqual({
      ok: false,
      refusal: { code: 'BENCH_SCOPE_CONFLICT', field: 'upTo' },
      message:
        'a bench runs either up to a node (upTo) or one node alone (only), not both',
      hint: 'keep one of upTo and only',
    });
    expect(refused({ item: 0 })).toEqual({
      ok: false,
      refusal: { code: 'BENCH_SCOPE_CONFLICT', field: 'item' },
      message:
        'item picks one item of the node a bench runs alone, so it needs only',
      hint: 'add only: <the forEach node>, or leave item out',
    });
  });

  it('an item of a node that does not run per item, or no item at all', () => {
    expect(refused({ only: 'fetch', item: 0 })).toEqual({
      ok: false,
      refusal: { code: 'BENCH_NOT_ITERATING', node: 'fetch' },
      message:
        'item picks one item of a forEach node, but "fetch" has no forEach',
      hint: 'leave item out to run "fetch" once',
    });
    expect(refused({ only: 'score', item: -1, mocks: { fetch: [] } })).toEqual({
      ok: false,
      refusal: { code: 'BENCH_ITEM_OUT_OF_RANGE', node: 'score', item: -1 },
      message: 'item -1 is not an item of "score" — items count from 0',
      hint: 'give the number of one item: 0 for the first',
    });
  });

  it('a node run alone without the data it reads', () => {
    expect(refused({ only: 'report' })).toEqual({
      ok: false,
      refusal: {
        code: 'BENCH_PINS_MISSING',
        node: 'report',
        missing: ['score'],
      },
      message:
        'running "report" alone needs the data of every node it reads — no data for "score"',
      hint: 'give each of them in mocks (the output it would have returned), or run up to "report" instead (upTo), which runs them',
    });
  });

  it('an item past the list, once the run knows the list', () => {
    expect(itemOutOfRange('score', 3, 2)).toEqual({
      refusal: {
        code: 'BENCH_ITEM_OUT_OF_RANGE',
        node: 'score',
        item: 3,
        count: 2,
      },
      message: 'item 3 is out of range — the forEach of "score" gave 2 items',
      hint: 'give an item from 0 to 1',
    });
    expect(itemOutOfRange('score', 0, 0).hint).toBe(
      'the list is empty — run the node without item',
    );
  });
});

describe('refusalIssue', () => {
  it('points into the bench a refusal is about, with its facts as params', () => {
    const unknown = refused({ mocks: { fetchh: [] } });
    expect(refusalPath(unknown.refusal)).toEqual(['mocks', 'fetchh']);
    expect(refusalIssue(unknown, '/tests/2/mocks/fetchh')).toEqual({
      level: 'error',
      code: 'BENCH_UNKNOWN_NODE',
      message: unknown.message,
      hint: unknown.hint,
      at: { pointer: '/tests/2/mocks/fetchh', subject: 'key' },
      params: { field: 'mocks', node: 'fetchh', suggestion: 'fetch' },
    });
    const pins = refused({ only: 'report' });
    expect(refusalPath(pins.refusal)).toEqual(['only']);
    expect(refusalIssue(pins, '/bench/only')).toMatchObject({
      at: { pointer: '/bench/only' },
      params: { node: 'report', missing: ['score'] },
    });
  });
});

describe('ancestorsOf', () => {
  it('is what a node reads, its alternative’s partner, and theirs', () => {
    expect([...ancestorsOf(NODES, 'report')].sort()).toEqual([
      'fetch',
      'score',
    ]);
    expect([...ancestorsOf(NODES, 'nothing')].sort()).toEqual([
      'fetch',
      'report',
      'score',
    ]);
    expect(ancestorsOf(NODES, 'clock').size).toBe(0);
  });

  it('counts a read in an agent’s staged files', () => {
    const nodes: NodeDef[] = [
      { id: 'folder', type: 'transform', code: 'return "f1";' },
      {
        id: 'draft',
        type: 'agent',
        model: 'm',
        prompt: 'Draft it.',
        files: { setup: '{{ nodes.folder.output }}' },
      },
    ];
    expect([...ancestorsOf(nodes, 'draft')]).toEqual(['folder']);
  });
});

describe('planBench — what stands in for each node', () => {
  it('a test’s stand-ins replace only the calls they name', () => {
    const planned = planBench(NODES, {
      mocks: { fetch: [5] },
      failures: { report: 'the sheet is locked' },
    });
    if (!planned.ok) throw new Error('refused');
    const { plan } = planned;
    expect(plan.included).toBeNull();
    expect(plan.focus).toBeUndefined();
    expect(plan.standIns).toEqual(['fetch', 'report']);
    expect(plan.call('fetch')).toEqual({ kind: 'mock', output: [5] });
    expect(plan.call('report')).toEqual({
      kind: 'fail',
      message: 'the sheet is locked',
    });
    expect(plan.call('score')).toEqual({ kind: 'call' });
  });

  it('up to a node: it and what it needs run, the rest is left out', () => {
    const planned = planBench(NODES, { upTo: 'report', mocks: { fetch: [] } });
    if (!planned.ok) throw new Error('refused');
    const { plan } = planned;
    expect([...(plan.included ?? [])].sort()).toEqual([
      'fetch',
      'report',
      'score',
    ]);
    expect(plan.focus).toEqual({ node: 'report', kind: 'upTo' });
    expect(plan.call('fetch')).toEqual({ kind: 'mock', output: [] });
    expect(plan.call('report')).toEqual({ kind: 'call' });
    expect(plan.call('nothing')).toEqual({ kind: 'left-out' });
    expect(plan.call('clock')).toEqual({ kind: 'left-out' });
  });

  it('one node alone: what it reads is pinned data, the rest left out', () => {
    const planned = planBench(NODES, {
      only: 'score',
      item: 1,
      mocks: { fetch: [1, 2], clock: 7 },
    });
    if (!planned.ok) throw new Error('refused');
    const { plan } = planned;
    expect([...(plan.included ?? [])].sort()).toEqual(['fetch', 'score']);
    expect(plan.focus).toEqual({ node: 'score', kind: 'only', item: 1 });
    expect(plan.call('fetch')).toEqual({ kind: 'pinned', output: [1, 2] });
    expect(plan.call('score')).toEqual({ kind: 'call' });
    expect(plan.call('clock')).toEqual({ kind: 'left-out' });
  });

  it('a node run alone does not need its alternative’s partner', () => {
    const planned = planBench(NODES, { only: 'nothing' });
    expect(planned.ok).toBe(true);
  });

  it('a forEach stand-in is a list with an entry per item', () => {
    const planned = planBench(NODES, {
      mocks: { score: [1, 2, 3], fetch: { rows: 2 } },
    });
    if (!planned.ok) throw new Error('refused');
    const { plan } = planned;
    expect(plan.itemOutputs('score', 2)).toEqual({
      ok: true,
      outputs: [1, 2, 3],
    });
    expect(plan.itemOutputs('score', 4)).toEqual({
      ok: false,
      message:
        'the test\'s simulated output for "score" has 3 entries, but forEach gave 4 items',
    });
    expect(plan.itemOutputs('fetch', 1)).toEqual({
      ok: false,
      message:
        'the test\'s simulated output for "fetch" is an object, but "fetch" runs once per item (forEach) — it needs a list',
    });
  });
});

describe('benchFromTest', () => {
  it('takes a test’s stand-ins and names the test', () => {
    expect(
      benchFromTest(
        {
          name: 'quiet day',
          input: {},
          mocks: { fetch: [] },
          failures: { report: 'locked' },
          expect: { output: [] },
        },
        3,
      ),
    ).toEqual({
      mocks: { fetch: [] },
      failures: { report: 'locked' },
      test: { name: 'quiet day', index: 3 },
    });
    expect(benchFromTest({ name: 'plain', input: {} })).toEqual({
      test: { name: 'plain' },
    });
  });
});
