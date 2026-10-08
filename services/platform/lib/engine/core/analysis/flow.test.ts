// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import type { Automation, NodeDef } from '../types';
import {
  analyzeFlow,
  constantCondition,
  flowModel,
  MAX_FREE_ATOMS,
  possiblePaths,
  simulate,
  type FlowFacts,
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
