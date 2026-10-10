// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { seeded } from '@tale/ui/data/random-json';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import type { Decision, NodeRunRecord } from '../record/types';
import type { Automation, NodeDef, NodeTrace } from '../types';
import {
  analyzeFlow,
  assignmentFromRun,
  constantCondition,
  flowModel,
  MAX_FREE_ATOMS,
  pathIdOf,
  possiblePaths,
  simulate,
  traceOutcome,
  type FlowFacts,
  type FlowModel,
  type PathOutcome,
} from './flow';

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../..',
);

function t(id: string, extra: Partial<NodeDef> = {}): NodeDef {
  return { id, type: 'transform', code: 'return 1;', ...extra };
}

/** A node that reads `from` as data. */
function reads(
  id: string,
  from: string,
  extra: Partial<NodeDef> = {},
): NodeDef {
  return t(id, { input: { v: `{{ nodes.${from}.output }}` }, ...extra });
}

function facts(nodes: NodeDef[]): FlowFacts {
  const f = analyzeFlow(nodes);
  if (f === null) throw new Error('cycle');
  return f;
}

describe('constantCondition', () => {
  it.each<[string, boolean | undefined]>([
    ['{{ true }}', true],
    ['{{ false }}', false],
    ['  {{ 1 > 2 }}  ', false],
    ['{{ [] }}', true],
    ["{{ '' }}", false],
    ['true', true],
    ['0', false],
    ['  ', undefined],
    ['{{ input.go }}', undefined],
    ['input.go', undefined],
    ['yes {{ input.go }}', true],
    ['{{ input.a }} {{ input.b }}', true],
    ['{{ input.a }}{{ input.b }}', undefined],
    ["{{ 'a' }}{{ 'b' }}", true],
    ["{{ '' }}{{ '' }}", false],
    ['{{ null }}{{ 1 }}', undefined],
    ['{{ unclosed', true],
    ['{{ nodes.a.output?.ok', true],
  ])('%j → %s', (text, value) => {
    expect(constantCondition(text)).toBe(value);
  });
});

describe('flowModel', () => {
  it('orders nodes like the executors and lists atoms in that order', () => {
    const model = flowModel([
      reads('b', 'a', { when: '{{ input.b }}', onError: 'continue' }),
      t('a', { when: '{{ true }}' }),
    ]);
    expect(model?.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(model?.atoms).toEqual([
      { id: 'when:a', kind: 'when', nodeId: 'a', fixed: true, value: true },
      { id: 'when:b', kind: 'when', nodeId: 'b' },
      { id: 'fail:b', kind: 'failure', nodeId: 'b' },
    ]);
  });

  it('is null on a cycle', () => {
    expect(flowModel([reads('a', 'b'), reads('b', 'a')])).toBeNull();
    expect(analyzeFlow([reads('a', 'b'), reads('b', 'a')])).toBeNull();
  });

  it('keeps the first of two nodes with one id', () => {
    const model = flowModel([t('a'), t('a', { when: '{{ input.x }}' })]);
    expect(model?.nodes).toHaveLength(1);
    expect(model?.atoms).toEqual([]);
  });
});

describe('paths', () => {
  it('a linear document has one path that runs everything', () => {
    const f = facts([t('a'), reads('b', 'a'), reads('c', 'b')]);
    expect(f.paths).toEqual([
      { id: '', assignment: {}, ran: ['a', 'b', 'c'], skipped: [] },
    ]);
    expect(f.reach('c')).toEqual({
      reached: true,
      executed: true,
      ran: true,
      always: true,
    });
    expect(f.halts).toEqual([
      { nodeId: 'a' },
      { nodeId: 'b' },
      { nodeId: 'c' },
    ]);
    expect(f.truncated).toBe(false);
  });

  it('a when and its elseOf partner run exclusively', () => {
    const f = facts([
      t('check', { when: '{{ input.ok }}' }),
      t('fallback', { elseOf: 'check' }),
      reads('after', 'check'),
    ]);
    expect(f.paths).toEqual([
      {
        id: 'when:check=1',
        assignment: { 'when:check': true },
        ran: ['check', 'after'],
        skipped: [{ nodeId: 'fallback', reason: 'else' }],
      },
      {
        id: 'when:check=0',
        assignment: { 'when:check': false },
        ran: ['fallback'],
        skipped: [
          { nodeId: 'check', reason: 'when' },
          { nodeId: 'after', reason: 'upstream', via: 'check' },
        ],
      },
    ]);
    const [first, second] = f.paths;
    expect(f.rootCause(first, 'fallback')).toEqual([
      { atom: 'when:check', nodeId: 'check' },
    ]);
    expect(f.rootCause(second, 'after')).toEqual([
      { atom: 'when:check', nodeId: 'check' },
    ]);
    expect(f.rootCause(first, 'after')).toEqual([]);
    expect(f.outcomeOf(second, 'after')).toBe('upstream');
    expect(f.outcomeOf(second, 'nope')).toBeUndefined();
    expect(f.maySkip('after')).toEqual([
      { nodeId: 'after', reason: 'upstream', via: 'check' },
    ]);
    expect(f.reach('fallback')).toEqual({
      reached: true,
      executed: true,
      ran: true,
      always: false,
    });
    expect(f.pathsWhere((p) => p.ran.includes('fallback'))).toEqual([second]);
  });

  it('a constant when is fixed, never a branch', () => {
    const f = facts([
      t('on', { when: '{{ true }}' }),
      t('off', { when: '{{ false }}' }),
      t('text', { when: 'run {{ input.x }}' }),
      t('else_off', { elseOf: 'off' }),
    ]);
    expect(f.paths).toHaveLength(1);
    expect(f.paths[0].ran).toEqual(['on', 'text', 'else_off']);
    expect(f.reach('off')).toEqual({
      reached: true,
      executed: false,
      ran: false,
      always: false,
    });
    expect(f.rootCause(f.paths[0], 'off')).toEqual([
      { atom: 'when:off', nodeId: 'off' },
    ]);
    expect(f.halts.map((h) => h.nodeId)).toEqual(['on', 'text', 'else_off']);
  });

  it('a node that continues on error skips its readers when it fails', () => {
    const f = facts([
      t('fetch', { onError: 'continue' }),
      reads('use', 'fetch'),
      t('control', { when: '{{ nodes.fetch.output !== null }}' }),
    ]);
    expect(f.paths.map((p) => p.id)).toEqual([
      'fail:fetch=0|when:control=1',
      'fail:fetch=0|when:control=0',
      'fail:fetch=1|when:control=1',
      'fail:fetch=1|when:control=0',
    ]);
    const failed = f.paths[2];
    expect(failed.skipped).toEqual([
      { nodeId: 'fetch', reason: 'error' },
      { nodeId: 'use', reason: 'upstream', via: 'fetch' },
    ]);
    expect(f.rootCause(failed, 'use')).toEqual([
      { atom: 'fail:fetch', nodeId: 'fetch' },
    ]);
    // A control reference orders, it does not propagate a skip.
    expect(failed.ran).toContain('control');
    expect(f.reach('fetch')).toEqual({
      reached: true,
      executed: true,
      ran: true,
      always: false,
    });
    expect(f.halts.map((h) => h.nodeId)).toEqual(['use', 'control']);
  });

  it('an elseOf node that reads its own partner never runs', () => {
    const f = facts([
      t('primary', { when: '{{ input.go }}' }),
      reads('backup', 'primary', { elseOf: 'primary' }),
    ]);
    expect(f.reach('backup')).toEqual({
      reached: false,
      executed: false,
      ran: false,
      always: false,
    });
    expect(f.maySkip('backup')).toEqual([
      { nodeId: 'backup', reason: 'else' },
      { nodeId: 'backup', reason: 'upstream', via: 'primary' },
    ]);
  });

  it("an elseOf branch answers to its partner's when, or to what skipped the partner", () => {
    const f = facts([
      t('src', { when: '{{ input.s }}' }),
      reads('gate', 'src', { when: '{{ input.g }}', onError: 'continue' }),
      t('alt', { elseOf: 'gate' }),
    ]);
    // The partner's when held: the branch is skipped whether the partner
    // then failed or not, so its failure is no cause.
    const failed = f.pathsWhere((p) => p.assignment['fail:gate'])[0];
    expect(f.rootCause(failed, 'alt')).toEqual([
      { atom: 'when:gate', nodeId: 'gate' },
    ]);
    const srcOff = f.pathsWhere((p) => p.ran.length === 0)[0];
    expect(srcOff.assignment).toEqual({ 'when:src': false });
    expect(f.rootCause(srcOff, 'alt')).toEqual([
      { atom: 'when:src', nodeId: 'src' },
    ]);
  });

  it('an elseOf naming no node is always skipped', () => {
    const f = facts([t('alt', { elseOf: 'ghost' })]);
    expect(f.paths[0].skipped).toEqual([{ nodeId: 'alt', reason: 'else' }]);
    expect(f.rootCause(f.paths[0], 'alt')).toEqual([]);
  });

  it('lists the paths with the most nodes run first', () => {
    const f = facts([
      t('a', { when: '{{ input.a }}' }),
      t('b', { when: '{{ input.b }}' }),
    ]);
    expect(f.paths.map((p) => [p.id, p.ran.length])).toEqual([
      ['when:a=1|when:b=1', 2],
      ['when:a=0|when:b=1', 1],
      ['when:a=1|when:b=0', 1],
      ['when:a=0|when:b=0', 0],
    ]);
  });
});

describe('simulate', () => {
  const model = flowModel([
    t('a', { when: '{{ input.a }}' }),
    reads('b', 'a', { onError: 'continue' }),
    t('c', { elseOf: 'a' }),
  ]);
  if (model === null) throw new Error('cycle');

  it('replays one assignment and reports the atoms it consulted', () => {
    expect(simulate(model, { 'when:a': false, 'fail:b': true })).toEqual({
      id: 'when:a=0',
      assignment: { 'when:a': false },
      ran: ['c'],
      skipped: [
        { nodeId: 'a', reason: 'when' },
        { nodeId: 'b', reason: 'upstream', via: 'a' },
      ],
    });
  });

  it('takes the quiet value for an atom it is not given', () => {
    expect(simulate(model, {})).toMatchObject({
      assignment: { 'when:a': true, 'fail:b': false },
      ran: ['a', 'b'],
    });
  });

  it('agrees with every enumerated path', () => {
    for (const p of possiblePaths(model).paths) {
      expect(simulate(model, p.assignment)).toEqual(p);
    }
  });
});

describe('beyond the enumeration limit', () => {
  const many = Array.from({ length: MAX_FREE_ATOMS + 1 }, (_, i) =>
    t(`w${i}`, { when: `{{ input.w${i} }}` }),
  );

  it('enumerates up to the limit', () => {
    expect(facts(many.slice(0, MAX_FREE_ATOMS)).paths).toHaveLength(
      2 ** MAX_FREE_ATOMS,
    );
  });

  it('falls back to the structure past it', () => {
    const f = facts([
      ...many,
      t('always'),
      reads('reader', 'w0'),
      t('never', { when: '{{ false }}' }),
      reads('dead', 'never'),
      t('else_dead', { elseOf: 'always' }),
      t('fails', { onError: 'continue' }),
      reads('after_fail', 'fails'),
    ]);
    expect(f.truncated).toBe(true);
    expect(f.paths).toEqual([]);
    expect(f.pathsWhere(() => true)).toEqual([]);
    expect(f.reach('always')).toEqual({
      reached: true,
      executed: true,
      ran: true,
      always: true,
    });
    expect(f.reach('reader')).toEqual({
      reached: true,
      executed: true,
      ran: true,
      always: false,
    });
    expect(f.maySkip('reader')).toEqual([
      { nodeId: 'reader', reason: 'upstream', via: 'w0' },
    ]);
    expect(f.reach('never')).toEqual({
      reached: true,
      executed: false,
      ran: false,
      always: false,
    });
    expect(f.reach('dead').reached).toBe(false);
    expect(f.reach('else_dead').reached).toBe(false);
    expect(f.maySkip('fails')).toEqual([{ nodeId: 'fails', reason: 'error' }]);
    expect(f.maySkip('after_fail')).toEqual([
      { nodeId: 'after_fail', reason: 'upstream', via: 'fails' },
    ]);
    expect(f.halts.map((h) => h.nodeId)).not.toContain('never');
  });
});

describe('a shipped pack: gmail/triage-inbox', () => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a shipped v1 pack; the corpus test validates it
  const pack = parse(
    readFileSync(
      path.join(
        REPO,
        'configs/platform/custom/automations/gmail/triage-inbox/workflow.yml',
      ),
      'utf8',
    ),
  ) as Automation;

  it('has a when on triage and a tolerated failure on propose', () => {
    const f = facts(pack.nodes);
    expect(f.atoms.map((a) => a.id)).toEqual(['when:triage', 'fail:propose']);
    expect(f.paths.map((p) => p.id)).toEqual([
      'when:triage=1|fail:propose=0',
      'when:triage=1|fail:propose=1',
      'when:triage=0',
    ]);
    expect(f.paths[2].ran).toEqual(['inbox']);
    expect(f.halts.map((h) => h.nodeId)).toEqual([
      'inbox',
      'triage',
      'record',
      'due',
      'draft',
    ]);
    expect(f.reach('propose')).toMatchObject({ executed: true, always: false });
    expect(f.maySkip('propose')).toEqual([
      // The first skipped node it reads, in reading order: its input reads
      // draft before its forEach reads due.
      { nodeId: 'propose', reason: 'upstream', via: 'draft' },
      { nodeId: 'propose', reason: 'error' },
    ]);
  });
});

/** A node's own record. */
function row(
  id: string,
  extra: Partial<NodeRunRecord> & { item?: number; pass?: number } = {},
): NodeRunRecord {
  const { item = -1, pass = -1, ...rest } = extra;
  return {
    key: { path: id, item, pass },
    nodeId: id.slice(id.lastIndexOf('/') + 1),
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

function decided(result: boolean): Decision {
  return {
    kind: 'when',
    result,
    value: { kind: 'boolean', text: String(result) },
    trace: { pointer: '', units: [] },
    at: 1,
  };
}

const continued: Decision = { kind: 'onError', policy: 'continue', at: 2 };

function entry(node: string, extra: Partial<NodeTrace> = {}): NodeTrace {
  return { node, type: 'transform', status: 'ok', ...extra };
}

/** The notes both executors write. */
const NOTES = {
  when: 'skipped: when="{{ input.a }}" was falsy',
  else: (partner: string) => `skipped: elseOf partner "${partner}" ran`,
  upstream: (via: string) => `skipped: reads from skipped node(s) ${via}`,
  error: 'onError: continue — dependents are skipped',
};

describe('traceOutcome', () => {
  it.each<[Partial<NodeTrace>, string]>([
    [{ status: 'ok' }, 'ran'],
    [{ status: 'error' }, 'error'],
    [{ status: 'error', note: NOTES.error }, 'error'],
    [{ status: 'skipped', note: NOTES.when }, 'when'],
    [{ status: 'skipped', note: NOTES.else('a') }, 'else'],
    [{ status: 'skipped', note: NOTES.upstream('a, b') }, 'upstream'],
    [{ status: 'skipped', note: 'skipped for a reason no one wrote' }, 'other'],
    [{ status: 'skipped' }, 'other'],
    [{ status: 'not_run' }, 'other'],
  ])('%j reads %s', (extra, outcome) => {
    expect(traceOutcome(entry('a', extra))).toBe(outcome);
  });
});

describe('assignmentFromRun', () => {
  const model = flowModel([
    t('a', { when: '{{ input.a }}' }),
    reads('b', 'a', { onError: 'continue' }),
    t('c', { elseOf: 'a' }),
    t('d', { when: '{{ true }}', onError: 'continue' }),
  ]);
  if (model === null) throw new Error('cycle');

  it('reads a condition from its recorded decision', () => {
    expect(
      assignmentFromRun(model, {
        record: [
          row('a', {
            status: 'skipped',
            skip: { reason: 'when' },
            decisions: [decided(false)],
          }),
          row('b', {
            status: 'skipped',
            skip: { reason: 'upstream', via: ['a'] },
          }),
          row('c'),
          row('d', { decisions: [decided(true)] }),
        ],
      }),
    ).toEqual({ 'when:a': false, 'fail:d': false });
  });

  it('takes the decision over what the status implies', () => {
    expect(
      assignmentFromRun(model, {
        record: [row('a', { decisions: [decided(false)] })],
      }),
    ).toEqual({ 'when:a': false });
  });

  it('reads a condition from the status when no decision was kept', () => {
    expect(assignmentFromRun(model, { record: [row('a')] })).toEqual({
      'when:a': true,
    });
    expect(
      assignmentFromRun(model, {
        record: [row('a', { status: 'skipped', skip: { reason: 'when' } })],
      }),
    ).toEqual({ 'when:a': false });
  });

  it('reads a tolerated failure from the record', () => {
    expect(
      assignmentFromRun(model, {
        record: [
          row('a'),
          row('b', { status: 'failed', skip: { reason: 'error' } }),
          row('d', { status: 'failed', decisions: [continued] }),
        ],
      }),
    ).toEqual({ 'when:a': true, 'fail:b': true, 'fail:d': true });
    expect(
      assignmentFromRun(model, {
        record: [row('b', { status: 'skipped', skip: { reason: 'error' } })],
      }),
    ).toEqual({ 'fail:b': true });
  });

  it('answers a condition, never the failure, of a step still working', () => {
    expect(
      assignmentFromRun(model, {
        record: [
          row('a'),
          row('b', { status: 'running' }),
          row('d', { status: 'waiting' }),
        ],
      }),
    ).toEqual({ 'when:a': true });
    // A step that started got past a condition it has.
    expect(
      assignmentFromRun(model, { record: [row('a', { status: 'waiting' })] }),
    ).toEqual({ 'when:a': true });
  });

  it('reads only each node’s own row at the top level', () => {
    expect(
      assignmentFromRun(model, {
        record: [
          row('b', { item: 0, status: 'failed' }),
          row('b', { pass: 1, status: 'failed' }),
          row('x[0:0]/a', { decisions: [decided(false)] }),
        ],
      }),
    ).toEqual({});
  });

  it('reads a run recorded before records were kept from its trace', () => {
    expect(
      assignmentFromRun(model, {
        trace: [
          entry('a'),
          entry('b', { status: 'error', note: NOTES.error }),
          entry('c', { status: 'skipped', note: NOTES.else('a') }),
          entry('d'),
        ],
      }),
    ).toEqual({ 'when:a': true, 'fail:b': true, 'fail:d': false });
    expect(
      assignmentFromRun(model, {
        trace: [
          entry('a', { status: 'skipped', note: NOTES.when }),
          entry('b', { status: 'skipped', note: NOTES.upstream('a') }),
          entry('c'),
          entry('d', { status: 'not_run' }),
        ],
      }),
    ).toEqual({ 'when:a': false });
  });

  it('answers from the record first and fills its gaps from the trace', () => {
    expect(
      assignmentFromRun(model, {
        record: [row('a', { decisions: [decided(true)] })],
        trace: [
          entry('a', { status: 'skipped', note: NOTES.when }),
          entry('b', { status: 'error', note: NOTES.error }),
        ],
      }),
    ).toEqual({ 'when:a': true, 'fail:b': true });
    // A row that answers nothing (a skip without a reason) leaves the
    // trace to answer.
    expect(
      assignmentFromRun(model, {
        record: [row('a', { status: 'skipped' })],
        trace: [entry('a')],
      }),
    ).toEqual({ 'when:a': true });
  });

  it('reads a condition that failed to evaluate as the trace does: the step got past it and failed', () => {
    const failedAtCondition = row('a', {
      status: 'failed',
      failure: {
        code: 'node_error',
        reason: 'EXPR_READ_MISSING',
        params: {},
        message: 'Cannot read properties of undefined',
        at: { pointer: '/nodes/0/when', range: [3, 10] },
      },
    });
    const fromRecord = assignmentFromRun(model, {
      record: [failedAtCondition],
    });
    const fromTrace = assignmentFromRun(model, {
      trace: [entry('a', { status: 'error' })],
    });
    expect(fromRecord).toEqual({ 'when:a': true });
    expect(fromRecord).toEqual(fromTrace);
  });

  it('names a path that exists for a run whose condition threw and went on', () => {
    // `d`'s condition threw under onError: continue; the run succeeded.
    const record = [
      row('a', { decisions: [decided(true)] }),
      row('b'),
      row('c', { status: 'skipped', skip: { reason: 'else' } }),
      row('d', {
        status: 'skipped',
        skip: { reason: 'error' },
        decisions: [{ kind: 'onError', policy: 'continue', at: 1 }],
        failure: {
          code: 'node_error',
          reason: 'EXPR_FAILED',
          params: {},
          message: 'boom',
          at: { pointer: '/nodes/3/when', range: [3, 7] },
        },
      }),
    ];
    const assignment = assignmentFromRun(model, { record });
    const id = pathIdOf(model, assignment);
    expect(possiblePaths(model).paths.map((p) => p.id)).toContain(id);
    expect(assignment['fail:d']).toBe(true);
  });

  it('answers nothing for an empty run', () => {
    expect(assignmentFromRun(model, {})).toEqual({});
  });
});

describe('pathIdOf', () => {
  const model = flowModel([
    t('a', { when: '{{ input.a }}' }),
    reads('b', 'a', { onError: 'continue' }),
    t('c', { elseOf: 'a' }),
  ]);
  if (model === null) throw new Error('cycle');

  it('names every enumerated path by its own id', () => {
    for (const p of possiblePaths(model).paths) {
      expect(pathIdOf(model, p.assignment)).toBe(p.id);
    }
  });

  it('leaves out what the run answered but never consulted', () => {
    expect(pathIdOf(model, { 'when:a': false, 'fail:b': true })).toBe(
      'when:a=0',
    );
  });

  it('ends at the first atom a run consulted without answering', () => {
    expect(pathIdOf(model, {})).toBe('');
    expect(pathIdOf(model, { 'when:a': true })).toBe('when:a=1');
    // An answer past the gap names no further step of the path.
    expect(pathIdOf(model, { 'fail:b': true })).toBe('');
  });
});

/** A random document of 2–8 nodes: data references, conditions that may
 * read earlier nodes, alternatives and tolerated failures. */
function generated(random: () => number): NodeDef[] {
  const pick = <T>(xs: readonly T[]): T =>
    xs[Math.floor(random() * xs.length)] as T;
  const count = 2 + Math.floor(random() * 7);
  const nodes: NodeDef[] = [];
  for (let i = 0; i < count; i++) {
    const id = `n${i}`;
    const earlier = nodes.map((n) => n.id);
    const input: Record<string, unknown> = {};
    for (const ref of earlier.filter(() => random() < 0.35)) {
      input[`r_${ref}`] = `{{ nodes.${ref}.output }}`;
    }
    const node: NodeDef = { id, type: 'transform', code: 'return 1;', input };
    if (random() < 0.3) node.onError = 'continue';
    if (random() < 0.4) {
      node.when =
        random() < 0.15
          ? pick(['{{ true }}', '{{ false }}'])
          : earlier.length > 0 && random() < 0.4
            ? `{{ (nodes.${pick(earlier)}.output, input.w_${id}) }}`
            : `{{ input.w_${id} }}`;
    }
    if (earlier.length > 0 && random() < 0.2) node.elseOf = pick(earlier);
    nodes.push(node);
  }
  return nodes;
}

/** What each executor would have recorded on path `p`. */
function recordedOn(model: FlowModel, p: PathOutcome): NodeRunRecord[] {
  return model.nodes.map((n) => {
    const gate = n.when.kind === 'none' ? [] : [decided(true)];
    if (p.ran.includes(n.id)) return row(n.id, { decisions: gate });
    const skip = p.skipped.find((s) => s.nodeId === n.id);
    if (skip === undefined) throw new Error(`${n.id} neither ran nor skipped`);
    switch (skip.reason) {
      case 'error':
        return row(n.id, {
          status: 'failed',
          skip: { reason: 'error' },
          decisions: [...gate, continued],
        });
      case 'when':
        return row(n.id, {
          status: 'skipped',
          skip: { reason: 'when' },
          decisions: [decided(false)],
        });
      default:
        return row(n.id, {
          status: 'skipped',
          skip: {
            reason: skip.reason,
            ...(skip.via !== undefined && { via: [skip.via] }),
          },
        });
    }
  });
}

/** What each executor would have traced on path `p`. */
function tracedOn(model: FlowModel, p: PathOutcome): NodeTrace[] {
  return model.nodes.map((n) => {
    if (p.ran.includes(n.id)) return entry(n.id);
    const skip = p.skipped.find((s) => s.nodeId === n.id);
    switch (skip?.reason) {
      case 'error':
        return entry(n.id, { status: 'error', note: NOTES.error });
      case 'when':
        return entry(n.id, { status: 'skipped', note: NOTES.when });
      case 'else':
        return entry(n.id, { status: 'skipped', note: NOTES.else('x') });
      default:
        return entry(n.id, {
          status: 'skipped',
          note: NOTES.upstream(skip?.via ?? ''),
        });
    }
  });
}

describe('a run placed among the paths [seeded]', () => {
  it('reads back the path of every run of 200 generated documents, from records, traces and both', () => {
    const random = seeded(20261009);
    let runs = 0;
    for (let d = 0; d < 200; d++) {
      const model = flowModel(generated(random));
      if (model === null) continue;
      const { paths, truncated } = possiblePaths(model);
      expect(truncated).toBe(false);
      for (const p of paths) {
        runs++;
        const record = recordedOn(model, p);
        const trace = tracedOn(model, p);
        const context = `document ${d} path ${p.id}`;
        expect(assignmentFromRun(model, { record }), context).toEqual(
          p.assignment,
        );
        expect(assignmentFromRun(model, { trace }), context).toEqual(
          p.assignment,
        );
        // A record with gaps, the trace filling them.
        const gappy = record.filter(() => random() < 0.5);
        expect(
          assignmentFromRun(model, { record: gappy, trace }),
          context,
        ).toEqual(p.assignment);
        expect(pathIdOf(model, p.assignment), context).toBe(p.id);
        // A run still going: the steps after some point have no record
        // yet, so its path is the start of this one.
        const reached = record.slice(
          0,
          Math.floor(random() * (record.length + 1)),
        );
        const prefix = pathIdOf(
          model,
          assignmentFromRun(model, { record: reached }),
        );
        expect(
          prefix === p.id || prefix === '' || p.id.startsWith(`${prefix}|`),
          `${context}: ${prefix}`,
        ).toBe(true);
      }
    }
    expect(runs).toBeGreaterThan(400);
  });
});
