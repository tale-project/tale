// @vitest-environment node

import { describe, expect, it } from 'vitest';

import type { Automation, Issue, NodeDef } from '../../types';
import { validate } from '../../validate';

function doc(nodes: NodeDef[]): Automation {
  return {
    version: 1,
    name: 'iteration-probe',
    nodes,
    output: `{{ nodes.${nodes.at(-1)?.id ?? 'x'}.output }}`,
  };
}

async function issues(d: Automation, code: string): Promise<Issue[]> {
  const { errors, warnings } = await validate(d);
  return [...errors, ...warnings].filter((i) => i.code === code);
}

const each = (forEach: string): NodeDef => ({
  id: 'each',
  type: 'transform',
  forEach,
  code: 'return item;',
});

describe('FOREACH_NOT_ARRAY', () => {
  it.each<[string, string, string | undefined]>([
    ['input.rows', 'not-a-template', undefined],
    ['rows: {{ input.rows }}', 'mixed-text', undefined],
    ['{{ input.a }}{{ input.b }}', 'mixed-text', undefined],
    ['{{ 5 }}', 'constant', 'number'],
    ["{{ 'abc' }}", 'constant', 'string'],
    ['{{ null }}', 'constant', 'null'],
    ['{{ input.rows', 'not-a-template', undefined],
  ])('%j → %s', async (forEach, reason, kind) => {
    const [issue] = await issues(doc([each(forEach)]), 'FOREACH_NOT_ARRAY');
    expect(issue).toMatchObject({
      level: 'error',
      at: { pointer: '/nodes/0/forEach' },
      params: { node: 'each', reason, value: forEach },
    });
    expect(issue.params?.kind).toBe(kind);
  });

  it('suggests the template a bare expression meant', async () => {
    const [issue] = await issues(
      doc([each('input.rows')]),
      'FOREACH_NOT_ARRAY',
    );
    expect(issue.hint).toBe('write it as a template: "{{ input.rows }}"');
  });

  it.each(['{{ input.rows }}', '  {{ [1, 2] }}  ', '{{ input.rows ?? [] }}'])(
    'accepts %j',
    async (forEach) => {
      expect(await issues(doc([each(forEach)]), 'FOREACH_NOT_ARRAY')).toEqual(
        [],
      );
    },
  );
});

describe('AGENT_ITERATION_UNSUPPORTED', () => {
  it('refuses an agent with forEach and with repeatUntil, each at its field', async () => {
    const found = await issues(
      doc([
        {
          id: 'review',
          type: 'agent',
          model: 'm',
          prompt: 'Review.',
          forEach: '{{ [1] }}',
          repeatUntil: '{{ output.status === "done" }}',
        },
      ]),
      'AGENT_ITERATION_UNSUPPORTED',
    );
    expect(found.map((i) => [i.level, i.at?.pointer])).toEqual([
      ['error', '/nodes/0/forEach'],
      ['error', '/nodes/0/repeatUntil'],
    ]);
  });

  it('accepts an agent that runs once', async () => {
    expect(
      await issues(
        doc([{ id: 'review', type: 'agent', model: 'm', prompt: 'Review.' }]),
        'AGENT_ITERATION_UNSUPPORTED',
      ),
    ).toEqual([]);
  });
});
