// @vitest-environment node

import { describe, expect, it } from 'vitest';

import type { Automation, Issue, NodeDef } from '../../types';
import { validate } from '../../validate';

function doc(nodes: NodeDef[], extra: Partial<Automation> = {}): Automation {
  return {
    version: 1,
    name: 'names-probe',
    nodes,
    output: `{{ nodes.${nodes.at(-1)?.id ?? 'x'}.output }}`,
    ...extra,
  };
}

async function issues(d: Automation, code: string): Promise<Issue[]> {
  const { errors, warnings } = await validate(d);
  return [...errors, ...warnings].filter((i) => i.code === code);
}

describe('EXPR_UNKNOWN_NAME', () => {
  it('names an undefined name, with the closest scope name', async () => {
    const [issue] = await issues(
      doc([
        { id: 'gen', type: 'llm', model: 'm', prompt: 'Hi {{ inptu.name }}' },
      ]),
      'EXPR_UNKNOWN_NAME',
    );
    expect(issue).toMatchObject({
      level: 'warning',
      at: { pointer: '/nodes/0/prompt', range: [6, 16] },
      params: { name: 'inptu', suggestion: 'input', field: 'prompt' },
    });
  });

  it('says where `output` exists when a template reads it', async () => {
    const [issue] = await issues(
      doc([{ id: 'gen', type: 'llm', model: 'm', prompt: '{{ output }}' }]),
      'EXPR_UNKNOWN_NAME',
    );
    expect(issue.hint).toContain('only in repeatUntil');
  });

  it('accepts globals, locals, typeof probes and names code assigns', async () => {
    const found = await issues(
      doc([
        {
          id: 'main',
          type: 'transform',
          input: { at: '{{ JSON.stringify(Math.max(1, 2)) }}' },
          code: [
            'total = 0;',
            'for (const x of [1, 2]) total += x;',
            'const seen = typeof missing === "undefined";',
            'return { total, seen, n: arguments.length };',
          ].join('\n'),
        },
      ]),
      'EXPR_UNKNOWN_NAME',
    );
    expect(found).toEqual([]);
  });

  it('leaves module and network access to CODE_NO_IO', async () => {
    const d = doc([
      { id: 'main', type: 'transform', code: 'return require("fs");' },
    ]);
    const { errors, warnings } = await validate(d);
    expect(errors.map((i) => i.code)).toContain('CODE_NO_IO');
    expect(warnings.map((i) => i.code)).not.toContain('EXPR_UNKNOWN_NAME');
  });

  it('flags a name a body reads but never declares', async () => {
    const [issue] = await issues(
      doc([{ id: 'main', type: 'transform', code: 'return helper(1);' }]),
      'EXPR_UNKNOWN_NAME',
    );
    expect(issue.params).toMatchObject({ name: 'helper', field: 'code' });
  });

  it('flags item in the document output, which no forEach ever declares', async () => {
    const [issue] = await issues(
      doc([{ id: 'main', type: 'transform', code: 'return 1;' }], {
        output: '{{ item }}',
      }),
      'EXPR_UNKNOWN_NAME',
    );
    expect(issue.at).toEqual({ pointer: '/output', range: [3, 7] });
  });
});

describe('ITEM_OUT_OF_SCOPE', () => {
  it('refuses item in the when of a forEach node — it is evaluated before the items', async () => {
    const [issue] = await issues(
      doc([
        {
          id: 'each',
          type: 'transform',
          forEach: '{{ [1, 2] }}',
          when: '{{ item > 1 }}',
          code: 'return item;',
        },
      ]),
      'ITEM_OUT_OF_SCOPE',
    );
    expect(issue).toMatchObject({
      level: 'error',
      params: { node: 'each', field: 'when', name: 'item' },
    });
    expect(issue.hint).toContain('filter the list in forEach');
  });

  it('refuses index in forEach itself', async () => {
    const [issue] = await issues(
      doc([
        {
          id: 'each',
          type: 'transform',
          forEach: '{{ input.lists[index] }}',
          code: 'return item;',
        },
      ]),
      'ITEM_OUT_OF_SCOPE',
    );
    expect(issue.params).toMatchObject({ field: 'forEach', name: 'index' });
  });

  it('refuses item in the when of a node that does not iterate', async () => {
    const [issue] = await issues(
      doc([
        {
          id: 'main',
          type: 'transform',
          when: '{{ item.ok }}',
          code: 'return 1;',
        },
      ]),
      'ITEM_OUT_OF_SCOPE',
    );
    expect(issue.message).toContain('per-item fields of a forEach node');
  });

  it('accepts a typeof probe of item in when', async () => {
    const found = await issues(
      doc([
        {
          id: 'each',
          type: 'transform',
          forEach: '{{ [1] }}',
          when: '{{ typeof item === "undefined" }}',
          code: 'return item;',
        },
      ]),
      'ITEM_OUT_OF_SCOPE',
    );
    expect(found).toEqual([]);
  });
});

describe('ITEM_WITHOUT_FOREACH', () => {
  it('is an error in a template and a warning in code', async () => {
    const { errors, warnings } = await validate(
      doc([
        { id: 'gen', type: 'llm', model: 'm', prompt: 'At {{ index }}' },
        { id: 'main', type: 'transform', code: 'return item ?? 1;' },
      ]),
    );
    expect(errors.filter((i) => i.code === 'ITEM_WITHOUT_FOREACH')).toEqual([
      expect.objectContaining({ nodeId: 'gen' }),
    ]);
    expect(warnings.filter((i) => i.code === 'ITEM_WITHOUT_FOREACH')).toEqual([
      expect.objectContaining({ nodeId: 'main' }),
    ]);
  });

  it('a local item in code is no read of the loop variable (triage-inbox `due`)', async () => {
    const found = await issues(
      doc([
        {
          id: 'due',
          type: 'transform',
          input: { items: '{{ input.items }}' },
          code: [
            'const out = [];',
            'for (const item of Array.isArray(input.items) ? input.items : []) {',
            '  if (item && item.action === "reply") out.push(item);',
            '}',
            'return { count: out.length, out };',
          ].join('\n'),
        },
      ]),
      'ITEM_WITHOUT_FOREACH',
    );
    expect(found).toEqual([]);
  });
});
