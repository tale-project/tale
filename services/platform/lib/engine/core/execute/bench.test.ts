// @vitest-environment node

import { describe, expect, it } from 'vitest';

import type { ConnectorScenario } from '../slots';
import type { Json, NodeDef } from '../types';
import {
  ancestorsOf,
  benchFromTest,
  itemOutOfRange,
  planBench,
  refusalIssue,
  refusalPath,
  scenarioMatches,
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
      refusal: {
        code: 'BENCH_CONFLICT',
        node: 'fetch',
        fields: ['mocks', 'failures'],
      },
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

/** A sheet read whose action ships scenarios, a sheet write whose action
 * ships none, and a transform, which is no connector action. */
const SHEET_NODES: NodeDef[] = [
  { id: 'rows', type: 'sheets.read', input: { sheet: 'Q3' } },
  {
    id: 'save',
    type: 'sheets.write',
    input: { rows: '{{ nodes.rows.output }}' },
  },
  {
    id: 'tally',
    type: 'transform',
    input: { rows: '{{ nodes.rows.output }}' },
    code: 'return input.rows.length;',
  },
];

const TWO_ROWS: ConnectorScenario = {
  name: 'two_rows',
  kind: 'success',
  description: 'The sheet has two rows.',
  output: [{ n: 1 }, { n: 2 }],
};
const RATE_LIMITED: ConnectorScenario = {
  name: 'rate_limited',
  kind: 'error',
  description: 'The service refuses: too many requests.',
  error: { message: 'too many requests', status: 429 },
};

/** The scenarios each type ships, as a catalog would answer them. */
const SHIPPED = new Map<string, readonly ConnectorScenario[]>([
  ['sheets.read', [TWO_ROWS, RATE_LIMITED]],
  ['sheets.write', []],
]);

function shippedOf(type: string): readonly ConnectorScenario[] {
  return SHIPPED.get(type) ?? [];
}

function refusedPick(bench: Parameters<typeof planBench>[1]) {
  const planned = planBench(SHEET_NODES, bench, shippedOf);
  if (planned.ok) throw new Error('expected a refusal');
  return planned;
}

describe('planBench — a scenario a test picks [AUTO-R78]', () => {
  it('a pick for a node the automation does not have, with the closest', () => {
    expect(refused({ scenarios: { fetchh: 'two_rows' } })).toEqual({
      ok: false,
      refusal: {
        code: 'BENCH_UNKNOWN_NODE',
        field: 'scenarios',
        node: 'fetchh',
        suggestion: 'fetch',
      },
      message:
        'the test picks a scenario for "fetchh", which is not a node of this automation',
      hint: 'did you mean "fetch"? nodes: fetch, score, report, nothing, clock',
    });
  });

  it('a pick beside an output or a failure for the same node', () => {
    expect(
      refusedPick({ mocks: { rows: [] }, scenarios: { rows: 'two_rows' } }),
    ).toEqual({
      ok: false,
      refusal: {
        code: 'BENCH_CONFLICT',
        node: 'rows',
        fields: ['mocks', 'scenarios'],
      },
      message:
        'the test both simulates an output and picks a scenario for "rows"',
      hint: 'keep one of mocks.rows and scenarios.rows',
    });
    expect(
      refusedPick({
        failures: { rows: 'down' },
        scenarios: { rows: 'two_rows' },
      }),
    ).toEqual({
      ok: false,
      refusal: {
        code: 'BENCH_CONFLICT',
        node: 'rows',
        fields: ['failures', 'scenarios'],
      },
      message:
        'the test both simulates a failure and picks a scenario for "rows"',
      hint: 'keep one of failures.rows and scenarios.rows',
    });
    // The conflict is what the test is told, whatever the name it picks.
    expect(
      refusedPick({ mocks: { rows: [] }, scenarios: { rows: 'no_such' } })
        .refusal,
    ).toEqual({
      code: 'BENCH_CONFLICT',
      node: 'rows',
      fields: ['mocks', 'scenarios'],
    });
  });

  it('a scenario the node’s action does not ship, with the closest when one is close', () => {
    expect(refusedPick({ scenarios: { rows: 'rate_limit' } })).toEqual({
      ok: false,
      refusal: {
        code: 'BENCH_UNKNOWN_SCENARIO',
        node: 'rows',
        type: 'sheets.read',
        scenario: 'rate_limit',
        scenarios: ['two_rows', 'rate_limited'],
        suggestion: 'rate_limited',
      },
      message:
        'the test picks the scenario "rate_limit" for "rows", which sheets.read does not ship',
      hint: 'did you mean "rate_limited"? scenarios of sheets.read: two_rows, rate_limited',
    });
    expect(refusedPick({ scenarios: { rows: 'sheet_locked' } })).toEqual({
      ok: false,
      refusal: {
        code: 'BENCH_UNKNOWN_SCENARIO',
        node: 'rows',
        type: 'sheets.read',
        scenario: 'sheet_locked',
        scenarios: ['two_rows', 'rate_limited'],
      },
      message:
        'the test picks the scenario "sheet_locked" for "rows", which sheets.read does not ship',
      hint: 'scenarios of sheets.read: two_rows, rate_limited',
    });
  });

  it('a scenario for a node whose type ships none: an action without them, or no action', () => {
    expect(refusedPick({ scenarios: { save: 'two_rows' } })).toEqual({
      ok: false,
      refusal: {
        code: 'BENCH_UNKNOWN_SCENARIO',
        node: 'save',
        type: 'sheets.write',
        scenario: 'two_rows',
        scenarios: [],
      },
      message:
        'the test picks the scenario "two_rows" for "save", which sheets.write does not ship',
      hint: 'sheets.write ships no scenarios — simulate its output (mocks) or its failure (failures) instead',
    });
    expect(refusedPick({ scenarios: { tally: 'two_rows' } }).refusal).toEqual({
      code: 'BENCH_UNKNOWN_SCENARIO',
      node: 'tally',
      type: 'transform',
      scenario: 'two_rows',
      scenarios: [],
    });
    // Planned by default, the registered node types answer: a transform
    // ships none.
    expect(refused({ scenarios: { fetch: 'two_rows' } })).toEqual({
      ok: false,
      refusal: {
        code: 'BENCH_UNKNOWN_SCENARIO',
        node: 'fetch',
        type: 'transform',
        scenario: 'two_rows',
        scenarios: [],
      },
      message:
        'the test picks the scenario "two_rows" for "fetch", which transform does not ship',
      hint: 'transform ships no scenarios — simulate its output (mocks) or its failure (failures) instead',
    });
  });

  it('the picked scenario stands in for its node’s call; the rest run as written', () => {
    const planned = planBench(
      SHEET_NODES,
      { scenarios: { rows: 'rate_limited' }, mocks: { tally: 2 } },
      shippedOf,
    );
    if (!planned.ok) throw new Error('refused');
    const { plan } = planned;
    expect(plan.included).toBeNull();
    // In document order, a pick among the other stand-ins.
    expect(plan.standIns).toEqual(['rows', 'tally']);
    expect(plan.call('rows')).toEqual({
      kind: 'scenario',
      scenario: RATE_LIMITED,
    });
    expect(plan.call('tally')).toEqual({ kind: 'mock', output: 2 });
    expect(plan.call('save')).toEqual({ kind: 'call' });

    // A step test's scope leaves a node out, whatever the test picks for it.
    const scoped = planBench(
      [
        ...SHEET_NODES,
        { id: 'archive', type: 'sheets.read', input: { sheet: 'Q2' } },
      ],
      { upTo: 'tally', scenarios: { rows: 'two_rows', archive: 'two_rows' } },
      shippedOf,
    );
    if (!scoped.ok) throw new Error('refused');
    expect(scoped.plan.standIns).toEqual(['rows', 'archive']);
    expect(scoped.plan.call('rows')).toEqual({
      kind: 'scenario',
      scenario: TWO_ROWS,
    });
    expect(scoped.plan.call('archive')).toEqual({ kind: 'left-out' });
    expect(scoped.plan.call('save')).toEqual({ kind: 'left-out' });
  });

  it('a test’s picks are part of its bench', () => {
    expect(
      benchFromTest(
        { name: 'busy', input: {}, scenarios: { rows: 'rate_limited' } },
        1,
      ),
    ).toEqual({
      scenarios: { rows: 'rate_limited' },
      test: { name: 'busy', index: 1 },
    });
  });

  it('a refusal points at the pick it is about, with its facts as params', () => {
    const unknownNode = refused({ scenarios: { fetchh: 'two_rows' } });
    expect(refusalPath(unknownNode.refusal)).toEqual(['scenarios', 'fetchh']);
    expect(refusalIssue(unknownNode, '/tests/0/scenarios/fetchh')).toEqual({
      level: 'error',
      code: 'BENCH_UNKNOWN_NODE',
      message: unknownNode.message,
      hint: unknownNode.hint,
      at: { pointer: '/tests/0/scenarios/fetchh', subject: 'key' },
      params: { field: 'scenarios', node: 'fetchh', suggestion: 'fetch' },
    });

    // A conflict points at the second of the two stand-ins.
    const both = refused({ mocks: { fetch: [] }, failures: { fetch: 'down' } });
    expect(refusalPath(both.refusal)).toEqual(['failures', 'fetch']);
    expect(refusalIssue(both, '/bench/failures/fetch')).toMatchObject({
      params: { node: 'fetch', fields: ['mocks', 'failures'] },
    });
    const conflict = refusedPick({
      failures: { rows: 'down' },
      scenarios: { rows: 'two_rows' },
    });
    expect(refusalPath(conflict.refusal)).toEqual(['scenarios', 'rows']);
    expect(refusalIssue(conflict, '/bench/scenarios/rows')).toEqual({
      level: 'error',
      code: 'BENCH_CONFLICT',
      message: conflict.message,
      hint: conflict.hint,
      at: { pointer: '/bench/scenarios/rows' },
      params: { node: 'rows', fields: ['failures', 'scenarios'] },
    });

    const unknownScenario = refusedPick({ scenarios: { rows: 'rate_limit' } });
    expect(refusalPath(unknownScenario.refusal)).toEqual(['scenarios', 'rows']);
    expect(refusalIssue(unknownScenario, '/tests/1/scenarios/rows')).toEqual({
      level: 'error',
      code: 'BENCH_UNKNOWN_SCENARIO',
      message: unknownScenario.message,
      hint: unknownScenario.hint,
      at: { pointer: '/tests/1/scenarios/rows' },
      params: {
        node: 'rows',
        type: 'sheets.read',
        scenario: 'rate_limit',
        scenarios: ['two_rows', 'rate_limited'],
        suggestion: 'rate_limited',
      },
    });
    const none = refusedPick({ scenarios: { save: 'two_rows' } });
    expect(refusalIssue(none, '/tests/1/scenarios/save').params).toEqual({
      node: 'save',
      type: 'sheets.write',
      scenario: 'two_rows',
      scenarios: [],
    });
  });
});

describe('scenarioMatches — the calls a picked scenario answers [AUTO-R78]', () => {
  function scenario(when?: Record<string, Json>): ConnectorScenario {
    return {
      name: 'open_bugs',
      kind: 'success',
      description: 'Two open bugs.',
      output: [{ id: 1 }, { id: 2 }],
      ...(when !== undefined && { when }),
    };
  }

  it('without when, it answers every call', () => {
    expect(scenarioMatches(scenario(), { repo: 'tale' })).toBe(true);
    expect(scenarioMatches(scenario(), {})).toBe(true);
    expect(scenarioMatches(scenario(), null)).toBe(true);
  });

  it('an input carrying every member of when, each equal as JSON, whatever its key order', () => {
    expect(
      scenarioMatches(
        scenario({
          repo: 'tale',
          filter: { state: 'open', labels: ['bug', 'p1'], page: { size: 2 } },
        }),
        {
          limit: 10,
          filter: { page: { size: 2 }, labels: ['bug', 'p1'], state: 'open' },
          repo: 'tale',
        },
      ),
    ).toBe(true);
  });

  it('an input missing a member of when does not match', () => {
    const when = { repo: 'tale', state: 'open' };
    expect(scenarioMatches(scenario(when), { repo: 'tale' })).toBe(false);
    expect(scenarioMatches(scenario(when), {})).toBe(false);
    // An input that is no object carries no member at all.
    expect(scenarioMatches(scenario(when), null)).toBe(false);
    expect(scenarioMatches(scenario(when), ['tale', 'open'])).toBe(false);
  });

  it('a member of another value does not match', () => {
    expect(
      scenarioMatches(scenario({ state: 'open' }), { state: 'closed' }),
    ).toBe(false);
    // Equal as JSON: a number is not its digits.
    expect(scenarioMatches(scenario({ limit: 10 }), { limit: '10' })).toBe(
      false,
    );
    // A nested member compares whole: one more key, or another order of a
    // list, is another value.
    expect(
      scenarioMatches(scenario({ filter: { state: 'open' } }), {
        filter: { state: 'open', mine: true },
      }),
    ).toBe(false);
    expect(
      scenarioMatches(scenario({ labels: ['bug', 'p1'] }), {
        labels: ['p1', 'bug'],
      }),
    ).toBe(false);
  });
});
