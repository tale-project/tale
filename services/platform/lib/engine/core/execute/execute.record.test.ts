import { beforeAll, describe, expect, it } from 'vitest';

import { nodeVmRunner } from '../../runners/node-vm';
import { createRecorder } from '../record/recorder';
import type { NodeRunRecord } from '../record/types';
import { setCodeRunner } from '../slots';
import type { Automation, NodeDef } from '../types';
import { execute } from './index';

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
});

function doc(nodes: NodeDef[], extra: Partial<Automation> = {}): Automation {
  return { version: 1, name: 'record-flow', nodes, ...extra };
}

function recorder() {
  let now = 1_000;
  return createRecorder({ now: () => (now += 1), clock: () => now });
}

function row(
  record: NodeRunRecord[] | undefined,
  path: string,
  item = -1,
  pass = -1,
): NodeRunRecord | undefined {
  return record?.find(
    (r) => r.key.path === path && r.key.item === item && r.key.pass === pass,
  );
}

const transform = (id: string, code: string, rest: Partial<NodeDef> = {}) => ({
  id,
  type: 'transform',
  input: {},
  code,
  ...rest,
});

describe('execute with a recorder', () => {
  it('answers no record without one, and the same result with one', async () => {
    const automation = doc(
      [
        transform('a', 'return { n: input.n + 1 };', {
          input: { n: '{{ input.n }}' },
        }),
      ],
      { output: '{{ nodes.a.output.n }}' },
    );
    const plain = await execute(automation, { input: { n: 1 } });
    const recorded = await execute(automation, {
      input: { n: 1 },
      recorder: recorder(),
    });
    expect(plain.record).toBeUndefined();
    const { record, ...rest } = recorded;
    expect(record).toBeDefined();
    expect(JSON.stringify(rest.output)).toBe(JSON.stringify(plain.output));
    expect(rest.trace.map(({ ms: _ms, ...t }) => t)).toEqual(
      plain.trace.map(({ ms: _ms, ...t }) => t),
    );
    expect(rest.effects).toEqual(plain.effects);
  });

  it('records the run input, each step and the output', async () => {
    const result = await execute(
      doc(
        [
          transform('a', 'return { n: input.n * 2 };', {
            input: { n: '{{ input.n }}' },
          }),
        ],
        { output: { total: '{{ nodes.a.output.n }}' } },
      ),
      { input: { n: 4 }, recorder: recorder() },
    );
    expect(result.record?.map((r) => r.key.path)).toEqual([
      '__start',
      'a',
      '__end',
    ]);
    expect(row(result.record, '__start')?.output?.value).toEqual({ n: 4 });
    expect(row(result.record, 'a')).toMatchObject({
      nodeType: 'transform',
      status: 'ok',
      input: { value: { n: 4 } },
      output: { value: { n: 8 } },
    });
    expect(row(result.record, '__end')?.output?.value).toEqual({ total: 8 });
  });

  it('records why a step was skipped, with the values its condition read', async () => {
    const result = await execute(
      doc([
        transform('gate', 'return 1;', { when: 'input.n > 10' }),
        transform('after', 'return nodes.gate.output;', {
          input: { v: '{{ nodes.gate.output }}' },
        }),
        transform('other', 'return 2;', { elseOf: 'gate' }),
      ]),
      { input: { n: 3 }, recorder: recorder() },
    );
    const gate = row(result.record, 'gate');
    expect(gate?.status).toBe('skipped');
    expect(gate?.skip).toEqual({ reason: 'when' });
    expect(gate?.decisions).toMatchObject([
      {
        kind: 'when',
        result: false,
        value: { kind: 'boolean', text: 'false' },
        trace: { pointer: '/nodes/0/when', units: [{ range: [0, 12] }] },
      },
    ]);
    expect(row(result.record, 'after')).toMatchObject({
      status: 'skipped',
      skip: { reason: 'upstream', via: ['gate'] },
      decisions: [{ kind: 'upstream', skipped: ['gate'] }],
    });
    expect(row(result.record, 'other')).toMatchObject({
      status: 'ok',
      decisions: [
        {
          kind: 'else',
          partner: 'gate',
          partnerSkippedByWhen: true,
          result: true,
        },
      ],
    });
  });

  it('records a forEach step, each item, and the list it ran over', async () => {
    const result = await execute(
      doc([
        transform('each', 'return item * 10;', { forEach: '{{ input.list }}' }),
      ]),
      { input: { list: [1, 2, 3] }, recorder: recorder() },
    );
    const step = row(result.record, 'each');
    expect(step).toMatchObject({
      status: 'ok',
      counts: { items: 3, ok: 3, failed: 0, skipped: 0, kept: 3 },
      decisions: [
        { kind: 'forEach', count: 3, value: { kind: 'array', length: 3 } },
      ],
      output: { value: [10, 20, 30] },
    });
    expect(row(result.record, 'each', 1)?.output?.value).toBe(20);
  });

  it('records each pass of a repeat, and whether it settled', async () => {
    const result = await execute(
      doc([
        transform('poll', 'return { tries: (index ?? 0) + 1 };', {
          repeatUntil: 'output.tries >= 1',
          maxRepeats: 3,
        }),
      ]),
      { input: {}, recorder: recorder() },
    );
    const pass = row(result.record, 'poll', -1, 0);
    expect(pass?.decisions).toMatchObject([
      { kind: 'repeatUntil', pass: 0, result: true, capped: false },
    ]);
    expect(row(result.record, 'poll')?.counts?.passes).toBe(1);
  });

  it('records a failure with its reason, its place and the item it was on', async () => {
    const result = await execute(
      doc([
        transform('each', 'return item.name.length;', {
          forEach: '{{ input.list }}',
        }),
      ]),
      { input: { list: [{ name: 'a' }, {}] }, recorder: recorder() },
    );
    expect(result.status).toBe('error');
    const step = row(result.record, 'each');
    expect(step?.status).toBe('failed');
    expect(step?.failure).toMatchObject({
      code: 'node_error',
      reason: 'CODE_FAILED',
      at: { pointer: '/nodes/0/code' },
    });
    expect(row(result.record, 'each', 1)?.status).toBe('failed');
    expect(row(result.record, 'each', 0)?.status).toBe('ok');
    // A failed run has no output record.
    expect(row(result.record, '__end')).toBeUndefined();
  });

  it('records a step that failed and let the run go on', async () => {
    const result = await execute(
      doc([
        transform('bad', 'return null;', { onError: 'continue' }),
        transform('next', 'return 1;'),
      ]),
      { input: {}, recorder: recorder() },
    );
    expect(result.status).toBe('success');
    expect(row(result.record, 'bad')).toMatchObject({
      status: 'skipped',
      skip: { reason: 'error' },
      failure: { reason: 'CODE_NO_RESULT' },
      decisions: [{ kind: 'onError', policy: 'continue' }],
    });
  });

  it('records a forEach that did not resolve to a list', async () => {
    const result = await execute(
      doc([transform('each', 'return 1;', { forEach: '{{ input.missing }}' })]),
      { input: {}, recorder: recorder() },
    );
    expect(result.error?.message).toBe(
      'forEach must resolve to an array, got undefined — check the referenced path',
    );
    expect(row(result.record, 'each')?.failure).toMatchObject({
      reason: 'FOREACH_NOT_LIST',
      params: { kind: 'undefined' },
      at: { pointer: '/nodes/0/forEach', range: [3, 16] },
    });
  });

  it('records an output that failed on the end unit', async () => {
    const result = await execute(doc([], { output: 'x={{ input.gone }}' }), {
      input: {},
      recorder: recorder(),
    });
    expect(row(result.record, '__end')).toMatchObject({
      status: 'failed',
      failure: {
        reason: 'TEMPLATE_VALUE_MISSING',
        at: { pointer: '/output', range: [5, 15] },
      },
    });
  });
});
