// @vitest-environment node

import { mutate, randomJson, seeded } from '@tale/ui/data/random-json';
import { stableStringify } from '@tale/ui/data/stable-stringify';
import { describe, expect, it } from 'vitest';

import type { Automation, NodeDef } from '../types';
import {
  COMPARE_MAX_EFFECTS,
  COMPARE_MAX_NODES,
  type CompareEffect,
  type CompareRun,
  compareRuns,
  compareValueRecords,
  NODE_DIFF_MAX_CHANGES,
  RUN_DIFF_MAX_BYTES,
  RUN_DIFF_MAX_CHANGES,
} from './compare';
import type {
  Decision,
  EvalTrace,
  NodeRunRecord,
  ValueElision,
  ValueRecord,
} from './types';
import { RECORD_LIMITS, recordValue, unlimitedBudget } from './value';

const recorded = (value: unknown): ValueRecord =>
  recordValue(value, 'node', unlimitedBudget());

/** Whether `pointer` lies in what a cut took away: a cut string or value
 * and what lies under it, or an item past those a list cut for length
 * kept — its kept items compare as they are. */
function inCut(
  marks: readonly ValueElision[],
  pointer: string,
  maxItems: number,
): boolean {
  return marks.some((mark) => {
    if (pointer !== mark.pointer && !pointer.startsWith(`${mark.pointer}/`)) {
      return false;
    }
    if (mark.kind !== 'items' || pointer === mark.pointer) return true;
    const [index = ''] = pointer.slice(mark.pointer.length + 1).split('/');
    return Number(index) >= maxItems;
  });
}

function row(path: string, over: Partial<NodeRunRecord> = {}): NodeRunRecord {
  return {
    key: { path, item: -1, pass: -1 },
    nodeId: path.split('/').at(-1) ?? path,
    nodeType: 'echo',
    status: 'ok',
    startedAt: 1000,
    endedAt: 1100,
    activeMs: 100,
    attempt: 1,
    attempts: [],
    decisions: [],
    waits: [],
    meta: {},
    ...over,
  };
}

const GATE = 'nodes.fetch.output.amount > 1000';

const v1: Automation = {
  name: 'invoice-triage',
  nodes: [
    { id: 'fetch', type: 'http.get', input: { id: '{{ input.id }}' } },
    { id: 'triage', type: 'echo', when: GATE, input: {} },
    {
      id: 'notify',
      type: 'slack.post',
      input: { text: '{{ nodes.triage.output }}' },
    },
  ],
  output: '{{ nodes.fetch.output }}',
};

function whenTrace(amount: number): EvalTrace {
  return {
    pointer: '/nodes/1/when',
    units: [
      {
        range: [0, GATE.length],
        probed: 'full',
        probes: [
          {
            range: [0, 25],
            v: { kind: 'number', text: String(amount), bytes: 3 },
          },
          { range: [28, 32], v: { kind: 'number', text: '1000', bytes: 4 } },
          {
            range: [0, GATE.length],
            v: { kind: 'boolean', text: String(amount > 1000), bytes: 4 },
          },
        ],
      },
    ],
  };
}

function when(amount: number): Decision {
  const result = amount > 1000;
  return {
    kind: 'when',
    result,
    value: { kind: 'boolean', text: String(result) },
    trace: whenTrace(amount),
    at: 1000,
  };
}

/** A run of `v1` (or `document`) with the given amount: `triage` runs when
 * the amount is over 1000, and `notify` only then. */
function invoiceRun(
  id: string,
  amount: number,
  over: Partial<CompareRun> = {},
): CompareRun {
  const input = { id: 'inv-1', amount };
  const fetched = { amount, currency: 'CHF' };
  const ran = amount > 1000;
  const records: NodeRunRecord[] = [
    row('__start', { nodeType: 'input', output: recorded(input) }),
    row('fetch', {
      input: recorded({ id: 'inv-1' }),
      output: recorded(fetched),
    }),
    row('triage', {
      status: ran ? 'ok' : 'skipped',
      decisions: [when(amount)],
      ...(ran
        ? { input: recorded({}), output: recorded('urgent') }
        : { skip: { reason: 'when' } }),
    }),
    ...(ran
      ? [
          row('notify', {
            input: recorded({ text: 'urgent' }),
            output: recorded({ ok: true }),
          }),
        ]
      : []),
    row('__end', { nodeType: 'output', output: recorded(fetched) }),
  ];
  return {
    id,
    version: 4,
    mode: 'live',
    status: 'succeeded',
    startedAt: 1000,
    finishedAt: 4200,
    document: v1,
    records,
    effects: ran
      ? [{ node: 'notify', connector: 'slack', input: { text: 'urgent' } }]
      : [],
    ...over,
  };
}

describe('compareRuns', () => {
  it('finds nothing between two runs that did the same', () => {
    const diff = compareRuns(invoiceRun('a', 2000), invoiceRun('b', 2000));
    expect(diff.a).toEqual({
      id: 'a',
      version: 4,
      mode: 'live',
      status: 'succeeded',
      startedAt: 1000,
      finishedAt: 4200,
      durationMs: 3200,
    });
    expect(diff.version).toEqual({
      same: true,
      changed: [],
      added: [],
      removed: [],
    });
    expect(diff.input).toMatchObject({ equal: true, changes: [], total: 0 });
    expect(diff.output).toMatchObject({ equal: true, changes: [], total: 0 });
    expect(diff.nodes.map((n) => n.path)).toEqual([
      '__start',
      'fetch',
      'triage',
      'notify',
      '__end',
    ]);
    expect(diff.nodes.every((n) => n.differs === undefined)).toBe(true);
    expect(diff.nodes.every((n) => n.decisions.length === 0)).toBe(true);
    expect(diff.firstDivergence).toBeUndefined();
    expect(diff.effects).toEqual({
      count: { a: 1, b: 1 },
      onlyA: [],
      onlyB: [],
      changed: [],
    });
    expect(diff.truncated).toBeUndefined();
    expect(diff.nodes[1]?.a).toEqual({
      status: 'ok',
      durationMs: 100,
      activeMs: 100,
      attempt: 1,
    });
  });

  it('lists how the inputs differ, field by field, as summaries', () => {
    const a = invoiceRun('a', 1500);
    const b = invoiceRun('b', 2000);
    const diff = compareRuns(a, b);
    expect(diff.input.equal).toBe(false);
    expect(diff.input.basis).toBe('value');
    expect(diff.input.changes).toEqual([
      {
        pointer: '/amount',
        path: ['amount'],
        kind: 'changed',
        before: { kind: 'number', text: '1500', bytes: 4 },
        after: { kind: 'number', text: '2000', bytes: 4 },
      },
    ]);
    expect(diff.input.total).toBe(1);
    // The Start step's output is the input; it is not where the runs split.
    expect(diff.nodes[0]).toMatchObject({ path: '__start', differs: 'output' });
    expect(diff.firstDivergence).toEqual({ path: 'fetch', why: 'output' });
  });

  it('finds the decision that flipped, and the values that flipped it', () => {
    const diff = compareRuns(invoiceRun('a', 250), invoiceRun('b', 2000));
    const triage = diff.nodes.find((n) => n.path === 'triage');
    expect(triage?.a).toMatchObject({ status: 'skipped', skip: 'when' });
    expect(triage?.b).toMatchObject({ status: 'ok' });
    expect(triage?.decisions).toEqual([
      {
        kind: 'when',
        a: { result: false, value: { kind: 'boolean', text: 'false' } },
        b: { result: true, value: { kind: 'boolean', text: 'true' } },
        sameSource: true,
        operands: [
          {
            range: [0, 25],
            a: { kind: 'number', text: '250', bytes: 3 },
            b: { kind: 'number', text: '2000', bytes: 3 },
          },
          {
            range: [0, GATE.length],
            a: { kind: 'boolean', text: 'false', bytes: 4 },
            b: { kind: 'boolean', text: 'true', bytes: 4 },
          },
        ],
      },
    ]);
    expect(triage?.differs).toBe('status');
    // `fetch` returned different amounts before the gate split them.
    expect(diff.firstDivergence).toEqual({ path: 'fetch', why: 'output' });
  });

  it('names a decision as the divergence when it differs and the status does not', () => {
    const a = invoiceRun('a', 2000);
    const b = invoiceRun('b', 2000);
    const flipped: Decision = {
      kind: 'repeatUntil',
      pass: 0,
      result: true,
      capped: false,
      value: { kind: 'boolean', text: 'true' },
      trace: { pointer: '/nodes/0/repeatUntil', units: [] },
      at: 1,
    };
    const withDecision = (run: CompareRun, decision: Decision): CompareRun => ({
      ...run,
      records: run.records.map((r) =>
        r.key.path === 'fetch' ? { ...r, decisions: [decision] } : r,
      ),
    });
    const diff = compareRuns(
      withDecision(a, flipped),
      withDecision(b, { ...flipped, result: false }),
    );
    expect(diff.firstDivergence).toEqual({ path: 'fetch', why: 'decision' });
    expect(diff.nodes[1]?.decisions).toEqual([
      {
        kind: 'repeatUntil',
        pass: 0,
        a: {
          result: true,
          capped: false,
          value: { kind: 'boolean', text: 'true' },
        },
        b: {
          result: false,
          capped: false,
          value: { kind: 'boolean', text: 'true' },
        },
        sameSource: false,
        operands: [],
      },
    ]);
  });

  it('compares a condition value by value only when both runs evaluated the same text', () => {
    const v2: Automation = {
      ...v1,
      nodes: v1.nodes.map((n) =>
        n.id === 'triage'
          ? { ...n, when: 'nodes.fetch.output.amount > 500' }
          : n,
      ),
    };
    const diff = compareRuns(
      invoiceRun('a', 250),
      invoiceRun('b', 2000, { document: v2, version: 5 }),
    );
    const triage = diff.nodes.find((n) => n.path === 'triage');
    expect(triage?.decisions).toMatchObject([
      { kind: 'when', sameSource: false, operands: [] },
    ]);
    expect(diff.version).toEqual({
      same: false,
      changed: ['triage'],
      added: [],
      removed: [],
    });
  });

  it('marks a step only one run recorded as missing from the other', () => {
    const diff = compareRuns(invoiceRun('a', 250), invoiceRun('b', 2000));
    const notify = diff.nodes.find((n) => n.path === 'notify');
    expect(notify).toMatchObject({ nodeId: 'notify', differs: 'missing' });
    expect(notify?.a).toBeUndefined();
    expect(notify?.b).toMatchObject({ status: 'ok' });
    expect(notify?.output).toMatchObject({
      equal: false,
      changes: [{ pointer: '', kind: 'added', after: { kind: 'object' } }],
    });
  });

  it('tells two values apart past what was stored of them, by their hashes', () => {
    const long = 'x'.repeat(10_000);
    const same = compareValueRecords(
      recorded({ body: long }),
      recorded({ body: long }),
    );
    expect(recorded({ body: long }).elided).toEqual([
      { pointer: '/body', kind: 'string', dropped: 10_000 - 4096 },
    ]);
    expect(same).toMatchObject({ equal: true, changes: [], total: 0 });

    // Different only after the stored 4096 characters.
    const other = `${'x'.repeat(9000)}y${'x'.repeat(999)}`;
    const differ = compareValueRecords(
      recorded({ body: long }),
      recorded({ body: other }),
    );
    expect(differ.equal).toBe(false);
    expect(differ.changes).toEqual([
      {
        pointer: '/body',
        path: ['body'],
        kind: 'unknown',
        before: expect.objectContaining({ length: 10_000, cut: true }),
        after: expect.objectContaining({ length: 10_000, cut: true }),
      },
    ]);
    expect(differ.counts.unknown).toBe(1);
    expect(differ.counts.changed).toBe(0);
  });

  it('reads two unhashed values as unknown unless their sizes differ', () => {
    const big = (bytes: number): ValueRecord => ({
      summary: { kind: 'string', length: bytes },
      shape: { type: 'string' },
      bytes,
      hash: null,
    });
    expect(compareValueRecords(big(5_000_000), big(5_000_000))).toMatchObject({
      equal: null,
      basis: 'shape',
      total: 0,
    });
    expect(compareValueRecords(big(5_000_000), big(5_000_001))).toMatchObject({
      equal: false,
      changes: [{ pointer: '', kind: 'unknown' }],
      total: 1,
    });
  });

  it('reads the version change: steps changed, added and removed, Start and End', () => {
    const v2: Automation = {
      name: v1.name,
      inputs: { type: 'object', properties: { id: { type: 'string' } } },
      nodes: [
        { id: 'fetch', type: 'http.get', input: { id: '{{ input.id }}' } },
        { id: 'triage', type: 'echo', when: GATE, input: { level: 2 } },
        {
          id: 'summary',
          type: 'echo',
          input: { x: '{{ nodes.fetch.output }}' },
        },
      ],
      output: '{{ nodes.summary.output }}',
    };
    const diff = compareRuns(
      invoiceRun('a', 2000),
      invoiceRun('b', 2000, { document: v2, version: 6 }),
    );
    expect(diff.version).toEqual({
      same: false,
      changed: ['__start', 'triage', '__end'],
      added: ['summary'],
      removed: ['notify'],
    });
  });

  it('matches effects by step, connector, item and pass, then by order', () => {
    const effectsA: CompareEffect[] = [
      { node: 'notify', connector: 'slack', input: { text: 'hi' } },
      { node: 'fetch', connector: 'http', input: { url: 'a' } },
      { node: 'loop', connector: 'mail', input: { to: 'a' }, item: 0 },
      { node: 'loop', connector: 'mail', input: { to: 'b' }, item: 1 },
      { node: 'auth', connector: 'crm', input: { token: 'one', q: 'x' } },
      { node: 'plain', connector: 'crm', input: { q: 'y' }, item: -1 },
    ];
    const effectsB: CompareEffect[] = [
      { node: 'fetch', connector: 'http', input: { url: 'a' } },
      { node: 'notify', connector: 'slack', input: { text: 'hello' } },
      { node: 'loop', connector: 'mail', input: { to: 'a' }, item: 0 },
      { node: 'notify', connector: 'slack', input: { text: 'again' } },
      { node: 'auth', connector: 'crm', input: { token: 'two', q: 'x' } },
      { node: 'plain', connector: 'crm', input: { q: 'y' } },
    ];
    const diff = compareRuns(
      invoiceRun('a', 2000, { effects: effectsA }),
      invoiceRun('b', 2000, { effects: effectsB }),
    );
    expect(diff.effects.count).toEqual({ a: 6, b: 6 });
    expect(diff.effects.changed).toEqual([
      {
        node: 'notify',
        connector: 'slack',
        n: 0,
        a: expect.objectContaining({ kind: 'object' }),
        b: expect.objectContaining({ kind: 'object' }),
        input: expect.objectContaining({
          equal: false,
          changes: [
            expect.objectContaining({
              pointer: '/text',
              kind: 'changed',
              before: expect.objectContaining({ text: 'hi' }),
              after: expect.objectContaining({ text: 'hello' }),
            }),
          ],
        }),
      },
    ]);
    expect(diff.effects.onlyB).toEqual([
      {
        node: 'notify',
        connector: 'slack',
        n: 1,
        b: expect.objectContaining({ kind: 'object', names: ['text'] }),
      },
    ]);
    expect(diff.effects.onlyA).toEqual([
      {
        node: 'loop',
        connector: 'mail',
        item: 1,
        n: 0,
        a: expect.objectContaining({ kind: 'object' }),
      },
    ]);
  });

  it('withholds secrets from the effects it lists', () => {
    const token = `ghp_${'a'.repeat(30)}`;
    const diff = compareRuns(
      invoiceRun('a', 2000, {
        effects: [{ node: 'hook', connector: 'http', input: token }],
      }),
      invoiceRun('b', 2000, { effects: [] }),
    );
    expect(diff.effects.onlyA).toEqual([
      { node: 'hook', connector: 'http', n: 0, a: { kind: 'redacted' } },
    ]);
  });

  it('caps each effect list and says so', () => {
    const many = Array.from(
      { length: COMPARE_MAX_EFFECTS + 5 },
      (_, item): CompareEffect => ({
        node: 'loop',
        connector: 'mail',
        input: { item },
        item,
      }),
    );
    const diff = compareRuns(
      invoiceRun('a', 2000, { effects: many }),
      invoiceRun('b', 2000, { effects: [] }),
    );
    expect(diff.effects.onlyA).toHaveLength(COMPARE_MAX_EFFECTS);
    expect(diff.effects.count.a).toBe(COMPARE_MAX_EFFECTS + 5);
    expect(diff.truncated).toEqual({ effects: true });
  });

  it('counts the items of a step that runs per item, and how many differ', () => {
    const loopDoc: Automation = {
      name: 'per-item',
      nodes: [{ id: 'loop', type: 'echo', forEach: '{{ input.list }}' }],
    };
    const itemRow = (item: number, out: unknown): NodeRunRecord => ({
      ...row('loop', { output: recorded(out) }),
      key: { path: 'loop', item, pass: -1 },
    });
    const base = (id: string, outs: unknown[]): CompareRun => ({
      id,
      version: 1,
      mode: 'mock',
      status: 'succeeded',
      startedAt: 0,
      document: loopDoc,
      records: [
        row('loop', {
          counts: {
            items: outs.length,
            ok: outs.length,
            failed: 0,
            skipped: 0,
            kept: outs.length,
          },
          output: recorded(outs),
        }),
        ...outs.map((out, item) => itemRow(item, out)),
      ],
      effects: [],
    });
    const diff = compareRuns(base('a', [1, 2, 3]), base('b', [1, 5, 3, 4]));
    expect(diff.nodes[0]?.items).toEqual({ a: 3, b: 4, differing: 2 });
    expect(diff.a.durationMs).toBeUndefined();
  });

  it('orders steps as B runs them, so the first divergence is the first B reached', () => {
    // Written out of order: `late` reads `early`.
    const d: Automation = {
      name: 'order',
      nodes: [
        { id: 'late', type: 'echo', input: { x: '{{ nodes.early.output }}' } },
        { id: 'early', type: 'echo' },
      ],
    };
    const make = (
      id: string,
      out: number,
      extra: NodeDef[] = [],
    ): CompareRun => ({
      id,
      version: 1,
      mode: 'live',
      status: 'succeeded',
      startedAt: 0,
      document: { ...d, nodes: [...d.nodes, ...extra] },
      records: [
        row('late', { output: recorded(out) }),
        row('early', { output: recorded(out) }),
        ...extra.map((n) => row(n.id)),
      ],
      effects: [],
    });
    const diff = compareRuns(
      make('a', 1, [{ id: 'gone', type: 'echo' }]),
      make('b', 2),
    );
    expect(diff.nodes.map((n) => n.path)).toEqual(['early', 'late', 'gone']);
    expect(diff.firstDivergence).toEqual({ path: 'early', why: 'output' });
    expect(diff.nodes[2]?.differs).toBe('missing');
  });

  it('places nested steps right after their parent, items in number order', () => {
    const d: Automation = {
      name: 'nested',
      nodes: [
        { id: 'batch', type: 'subautomation', automation: 'child' },
        { id: 'after', type: 'echo', input: { x: '{{ nodes.batch.output }}' } },
      ],
    };
    const nested = (item: number, docRef: string, result: boolean) =>
      row(`batch[${item}:-1]/inner`, {
        meta: { docRef },
        decisions: [
          {
            kind: 'when',
            result,
            value: { kind: 'boolean', text: String(result) },
            trace: {
              pointer: '/nodes/0/when',
              units: [
                {
                  range: [0, 5],
                  probed: 'full',
                  probes: [
                    {
                      range: [0, 5],
                      v: { kind: 'boolean', text: String(result) },
                    },
                  ],
                },
              ],
            },
            at: 0,
          },
        ],
      });
    const make = (id: string, docRef: string, flip: boolean): CompareRun => ({
      id,
      version: 1,
      mode: 'live',
      status: 'succeeded',
      startedAt: 0,
      document: d,
      records: [
        row('after'),
        nested(10, docRef, true),
        nested(2, docRef, flip),
        row('batch'),
        nested(0, docRef, true),
      ],
      effects: [],
    });
    const same = compareRuns(
      make('a', 'child@1', true),
      make('b', 'child@1', false),
    );
    expect(same.nodes.map((n) => n.path)).toEqual([
      'batch',
      'batch[0:-1]/inner',
      'batch[2:-1]/inner',
      'batch[10:-1]/inner',
      'after',
    ]);
    expect(same.firstDivergence).toEqual({
      path: 'batch[2:-1]/inner',
      why: 'decision',
    });
    expect(same.nodes[2]?.decisions[0]).toMatchObject({
      sameSource: true,
      operands: [{ range: [0, 5] }],
    });
    const across = compareRuns(
      make('a', 'child@1', true),
      make('b', 'child@2', false),
    );
    expect(across.nodes[2]?.decisions[0]).toMatchObject({
      sameSource: false,
      operands: [],
    });
  });

  it('compares a repeating step pass by pass', () => {
    const d: Automation = {
      name: 'poll',
      nodes: [{ id: 'poll', type: 'echo', repeatUntil: 'output.done' }],
    };
    const passRow = (pass: number, result: boolean): NodeRunRecord => ({
      ...row('poll', {
        decisions: [
          {
            kind: 'repeatUntil',
            pass,
            result,
            capped: false,
            value: { kind: 'boolean', text: String(result) },
            trace: { pointer: '/nodes/0/repeatUntil', units: [] },
            at: 0,
          },
        ],
      }),
      key: { path: 'poll', item: -1, pass },
    });
    const make = (id: string, passes: boolean[]): CompareRun => ({
      id,
      version: 1,
      mode: 'live',
      status: 'succeeded',
      startedAt: 0,
      document: d,
      records: [row('poll'), ...passes.map((r, pass) => passRow(pass, r))],
      effects: [],
    });
    const diff = compareRuns(
      make('a', [false, true]),
      make('b', [false, false, true]),
    );
    expect(
      diff.nodes[0]?.decisions.map((x) => [x.pass, x.a?.result, x.b?.result]),
    ).toEqual([
      [1, true, false],
      [2, undefined, true],
    ]);
  });

  it('withholds secrets from the values a step differs in', () => {
    const token = `ghp_${'b'.repeat(30)}`;
    // Withheld before hashing: two passwords read alike.
    expect(
      compareValueRecords(
        recorded({ user: 'ada', password: 'one' }),
        recorded({ user: 'ada', password: 'two' }),
      ),
    ).toMatchObject({ equal: true, total: 0 });
    const diff = compareValueRecords(
      recorded({ note: token }),
      recorded({ note: 'plain' }),
    );
    expect(diff.equal).toBe(false);
    expect(diff.changes).toEqual([
      {
        pointer: '/note',
        path: ['note'],
        kind: 'unknown',
        before: { kind: 'redacted' },
        after: { kind: 'string', text: 'plain', length: 5, bytes: 7 },
      },
    ]);
  });

  it('falls back to the shapes when a value was not stored', () => {
    const spent = { left: 0 };
    const a = recordValue({ id: 1, name: 'x' }, 'node', spent);
    const b = recordValue({ id: 1, tags: ['y'] }, 'node', spent);
    expect(a.value).toBeUndefined();
    const diff = compareValueRecords(a, b);
    expect(diff).toMatchObject({ equal: false, basis: 'shape' });
    expect(diff.changes).toEqual([
      {
        pointer: '/name',
        path: ['name'],
        kind: 'removed',
        shape: { before: 'string' },
      },
      {
        pointer: '/tags',
        path: ['tags'],
        kind: 'added',
        shape: { after: 'array' },
      },
    ]);
  });
});

describe('compareRuns, held to its size and order', () => {
  it('orders a step’s nested steps by when they started', () => {
    const d: Automation = {
      name: 'nested',
      nodes: [{ id: 'batch', type: 'subautomation', automation: 'child' }],
    };
    const make = (id: string): CompareRun => ({
      id,
      version: 1,
      mode: 'live',
      status: 'succeeded',
      startedAt: 0,
      document: d,
      records: [
        row('batch[0:-1]/alpha', { startedAt: 300 }),
        row('batch', { startedAt: 100 }),
        row('batch[0:-1]/zeta', { startedAt: 200 }),
      ],
      effects: [],
    });
    expect(compareRuns(make('a'), make('b')).nodes.map((n) => n.path)).toEqual([
      'batch',
      'batch[0:-1]/zeta',
      'batch[0:-1]/alpha',
    ]);
  });

  it('lists rows up to the cap, the first divergence always among them', () => {
    const nodes = Array.from(
      { length: COMPARE_MAX_NODES + 10 },
      (_, i): NodeDef => ({ id: `s${i}`, type: 'echo' }),
    );
    const make = (id: string, last: number): CompareRun => ({
      id,
      version: 1,
      mode: 'live',
      status: 'succeeded',
      startedAt: 0,
      document: { name: 'many', nodes },
      records: nodes.map((n, i) =>
        row(n.id, { output: recorded(i === nodes.length - 1 ? last : 0) }),
      ),
      effects: [],
    });
    const diff = compareRuns(make('a', 1), make('b', 2));
    expect(diff.truncated).toEqual({ nodes: true });
    expect(diff.nodes).toHaveLength(COMPARE_MAX_NODES);
    expect(diff.nodes.at(-1)?.path).toBe(`s${COMPARE_MAX_NODES + 9}`);
    expect(diff.firstDivergence).toEqual({
      path: `s${COMPARE_MAX_NODES + 9}`,
      why: 'output',
    });
  });

  it('lists more of the run’s own input and output changes', () => {
    const fields = (shift: number) =>
      Object.fromEntries(
        Array.from({ length: RUN_DIFF_MAX_CHANGES + 50 }, (_, i) => [
          `f${i}`,
          i + shift,
        ]),
      );
    const make = (id: string, shift: number): CompareRun => ({
      id,
      version: 1,
      mode: 'live',
      status: 'succeeded',
      startedAt: 0,
      document: { name: 'wide-input', nodes: [] },
      records: [row('__start', { output: recorded(fields(shift)) })],
      effects: [],
    });
    const diff = compareRuns(make('a', 0), make('b', 1));
    expect(diff.input).toMatchObject({
      equal: false,
      total: RUN_DIFF_MAX_CHANGES + 50,
      truncated: true,
    });
    expect(diff.input.changes).toHaveLength(RUN_DIFF_MAX_CHANGES);
  });

  it('drops the value changes first, and keeps every row', () => {
    const nodes = Array.from({ length: 100 }, (_, i): NodeDef => ({
      id: `s${i}`,
      type: 'echo',
    }));
    const value = (i: number, shift: number) =>
      Object.fromEntries(
        Array.from({ length: 20 }, (_, k) => [
          `f${k}`,
          `${'v'.repeat(60)}${i + k + shift}`,
        ]),
      );
    const make = (id: string, shift: number): CompareRun => ({
      id,
      version: 1,
      mode: 'live',
      status: 'succeeded',
      startedAt: 0,
      document: { name: 'wide', nodes },
      records: nodes.map((n, i) =>
        row(n.id, {
          input: recorded(value(i, shift)),
          output: recorded(value(i, shift)),
        }),
      ),
      effects: [],
    });
    const diff = compareRuns(make('a', 0), make('b', 1));
    expect(diff.truncated).toEqual({ values: true });
    expect(diff.nodes).toHaveLength(100);
    expect(diff.nodes[7]?.output).toMatchObject({
      equal: false,
      changes: [],
      total: 20,
      truncated: true,
    });
    expect(diff.firstDivergence).toEqual({ path: 's0', why: 'input' });
    expect(
      new TextEncoder().encode(JSON.stringify(diff)).length,
    ).toBeLessThanOrEqual(RUN_DIFF_MAX_BYTES);
  });

  it('then drops rows from the end, never the first divergence', () => {
    const nodes = Array.from({ length: 900 }, (_, i): NodeDef => ({
      id: `step-${String(i).padStart(3, '0')}-${'x'.repeat(400)}`,
      type: 'echo',
    }));
    const make = (id: string, last: number): CompareRun => ({
      id,
      version: 1,
      mode: 'live',
      status: 'succeeded',
      startedAt: 0,
      document: { name: 'long', nodes },
      records: nodes.map((n, i) =>
        row(n.id, { output: recorded(i === nodes.length - 1 ? last : i) }),
      ),
      effects: [],
    });
    const diff = compareRuns(make('a', 1), make('b', 2));
    // The divergent row's output change goes first, then rows.
    expect(diff.truncated).toEqual({ nodes: true, values: true });
    expect(diff.nodes.at(-1)?.output).toMatchObject({
      equal: false,
      changes: [],
      total: 1,
    });
    expect(diff.nodes.length).toBeLessThan(COMPARE_MAX_NODES);
    expect(diff.firstDivergence?.path).toMatch(/^step-899-/);
    expect(diff.nodes.at(-1)?.path).toBe(diff.firstDivergence?.path);
    expect(diff.nodes.at(-2)?.path).toMatch(
      new RegExp(`^step-${String(diff.nodes.length - 2).padStart(3, '0')}-`),
    );
    expect(
      new TextEncoder().encode(JSON.stringify(diff)).length,
    ).toBeLessThanOrEqual(RUN_DIFF_MAX_BYTES);
  });
});

describe('compareValueRecords', () => {
  it('has nothing to compare when neither side has a value', () => {
    expect(compareValueRecords(undefined, undefined)).toEqual({
      equal: null,
      changes: [],
      counts: expect.objectContaining({ changed: 0 }),
      total: 0,
      truncated: false,
      basis: 'none',
    });
    expect(
      compareValueRecords(recorded(undefined), undefined).equal,
    ).toBeNull();
  });

  it('settles unhashed values from what was kept of them', () => {
    const huge = (id: number): ValueRecord => ({
      value: { id, body: 'x' },
      summary: { kind: 'object', keys: 2, names: ['id', 'body'] },
      shape: { type: 'object' },
      bytes: 5_000_000,
      hash: null,
      elided: [{ pointer: '/body', kind: 'string', dropped: 4_999_980 }],
    });
    // A field outside the cut differs: the values differ. The cut text
    // may differ too, and says so.
    expect(compareValueRecords(huge(1), huge(2))).toMatchObject({
      equal: false,
      changes: [
        {
          pointer: '/body',
          kind: 'unknown',
          before: { kind: 'string', length: 5_000_000 - 19, cut: true },
        },
        { pointer: '/id', kind: 'changed' },
      ],
    });
    // Only the cut text could differ: it cannot be told.
    expect(compareValueRecords(huge(1), huge(1))).toMatchObject({
      equal: null,
      changes: [],
    });
  });

  it('reads a value on one side only as added or removed whole', () => {
    expect(compareValueRecords(recorded([1]), undefined)).toMatchObject({
      equal: false,
      changes: [{ pointer: '', kind: 'removed', before: { kind: 'array' } }],
      total: 1,
    });
    expect(compareValueRecords(undefined, recorded('x'))).toMatchObject({
      equal: false,
      changes: [{ pointer: '', kind: 'added', after: { kind: 'string' } }],
    });
  });

  it('lists at most the changes asked for, and counts them all', () => {
    const a = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`k${i}`, i]),
    );
    const b = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`k${i}`, i + 1]),
    );
    const diff = compareValueRecords(recorded(a), recorded(b));
    expect(diff.changes).toHaveLength(NODE_DIFF_MAX_CHANGES);
    expect(diff.total).toBe(30);
    expect(diff.truncated).toBe(true);
    expect(
      compareValueRecords(recorded(a), recorded(b), 200).changes,
    ).toHaveLength(30);
  });

  it('agrees with value equality on random values, and never calls a cut place changed', () => {
    const random = seeded(20_261_009);
    for (let round = 0; round < 300; round++) {
      const before = randomJson(random, 4);
      const after = random() < 0.3 ? before : mutate(random, before, 2);
      const tier = random() < 0.5 ? 'node' : 'unit';
      const a = recordValue(before, tier, unlimitedBudget());
      const b = recordValue(after, tier, unlimitedBudget());
      const diff = compareValueRecords(a, b, 500);
      const same = stableStringify(before) === stableStringify(after);
      if (a.summary.kind === 'undefined' && b.summary.kind === 'undefined') {
        expect(diff.equal).toBeNull();
        continue;
      }
      expect(diff.equal).toBe(same);
      expect(compareValueRecords(b, a, 500).equal).toBe(diff.equal);
      if (!same) expect(diff.changes.length).toBeGreaterThan(0);
      if (same) expect(diff.total).toBe(0);
      const marks = [...(a.elided ?? []), ...(b.elided ?? [])];
      for (const change of diff.changes) {
        if (inCut(marks, change.pointer, RECORD_LIMITS[tier].maxItems)) {
          expect(change.kind).not.toBe('changed');
        }
      }
    }
  });

  it('stays exact on random values past the stored bounds', () => {
    // Strings around the unit tier's 1024 characters and lists around its
    // 20 items: some edits land in what is kept, some only in what was cut.
    const random = seeded(7);
    let cutRounds = 0;
    for (let round = 0; round < 300; round++) {
      const text = Array.from(
        { length: 1000 + Math.floor(random() * 60) },
        () => (random() < 0.5 ? 'a' : 'b'),
      );
      const list = Array.from({ length: 15 + Math.floor(random() * 10) }, () =>
        randomJson(random, 2),
      );
      const before = { text: text.join(''), list, more: randomJson(random, 3) };
      const edited = [...text];
      const at = Math.floor(random() * edited.length);
      edited[at] = edited[at] === 'a' ? 'b' : 'a';
      const after =
        random() < 0.25
          ? before
          : random() < 0.5
            ? { ...before, text: edited.join('') }
            : (mutate(random, before, 2) as object);
      const a = recordValue(before, 'unit', unlimitedBudget());
      const b = recordValue(after, 'unit', unlimitedBudget());
      const marks = [...(a.elided ?? []), ...(b.elided ?? [])];
      if (marks.length > 0) cutRounds++;
      const diff = compareValueRecords(a, b, 500);
      const same = stableStringify(before) === stableStringify(after);
      expect(diff.equal).toBe(same);
      if (!same) expect(diff.changes.length).toBeGreaterThan(0);
      for (const change of diff.changes) {
        if (inCut(marks, change.pointer, RECORD_LIMITS.unit.maxItems)) {
          expect(change.kind).not.toBe('changed');
        }
      }
    }
    expect(cutRounds).toBeGreaterThan(100);
  });

  it('tells a withheld secret from a null, though both hash alike', () => {
    const token = `ghp_${'c'.repeat(30)}`;
    expect(
      compareValueRecords(recorded({ note: token }), recorded({ note: null })),
    ).toMatchObject({
      equal: false,
      total: 1,
      changes: [
        {
          pointer: '/note',
          kind: 'unknown',
          before: { kind: 'redacted' },
          after: { kind: 'null' },
        },
      ],
    });
    // Two secrets at the same place read alike.
    expect(
      compareValueRecords(
        recorded({ note: token }),
        recorded({ note: `ghp_${'d'.repeat(30)}` }),
      ).equal,
    ).toBe(true);
  });

  it('reads each side’s cuts at its own places in a list', () => {
    // Past the node tier's 4096 characters: each side cuts the string
    // where it holds it.
    const long = 'z'.repeat(5000);
    const diff = compareValueRecords(
      recorded({ list: [long, 'k'] }),
      recorded({ list: ['new', long, 'k'] }),
    );
    expect(diff.equal).toBe(false);
    expect(diff.changes.map((c) => [c.pointer, c.kind])).toEqual([
      ['/list/0', 'unknown'],
      ['/list/1', 'unknown'],
      ['/list/2', 'added'],
    ]);
  });

  it('compares the kept items of a list cut for length as they are', () => {
    const list = Array.from({ length: 30 }, (_, i) => i);
    const edited = (at: number) => list.map((n, i) => (i === at ? -1 : n));
    const unit = (value: unknown) =>
      recordValue(value, 'unit', unlimitedBudget());
    expect(
      compareValueRecords(unit({ list }), unit({ list: edited(3) })),
    ).toMatchObject({
      equal: false,
      changes: [{ pointer: '/list/3', kind: 'changed' }],
    });
    // Only an item past the kept ones changed: where, the record cannot
    // say.
    expect(
      compareValueRecords(unit({ list }), unit({ list: edited(25) })),
    ).toMatchObject({
      equal: false,
      changes: [{ pointer: '/list', kind: 'unknown', before: { length: 30 } }],
    });
  });

  it('invents no change from shapes that were cut short', () => {
    // More fields than a shape keeps: each side's shape holds the first 50
    // it met, so a field one shape left out is not gone from its value.
    const spent = { left: 0 };
    const fields = Array.from({ length: 55 }, (_, i) => [`k${i}`, i]);
    const a = recordValue(Object.fromEntries(fields), 'node', spent);
    const b = recordValue(
      Object.fromEntries([['first', 0], ...fields.slice(0, 54)]),
      'node',
      spent,
    );
    expect(a.value).toBeUndefined();
    const diff = compareValueRecords(a, b);
    expect(diff).toMatchObject({ equal: false, basis: 'shape' });
    expect(diff.changes.length).toBeGreaterThan(0);
    expect(diff.changes.every((c) => c.kind === 'unknown')).toBe(true);
  });
});
