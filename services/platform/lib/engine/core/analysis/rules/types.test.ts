// @vitest-environment node

import { beforeAll, describe, expect, it } from 'vitest';

import { memoryStore } from '../../../selftest/memory-store';
import { registerNodeType } from '../../slots';
import type { Automation, Issue, NodeDef } from '../../types';
import { validate, type ValidateOptions } from '../../validate';

beforeAll(() => {
  registerNodeType({
    type: 'weather.current',
    kind: 'connector',
    outputKind: 'structured',
    description: 'test connector: current weather',
    allowedFields: ['input'],
    requiredFields: ['input'],
    connector: {
      name: 'weather.current',
      description: 'current weather for a city',
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string' },
          days: { type: 'integer' },
        },
        required: ['city'],
        additionalProperties: false,
      },
      outputSignature: '{ tempC: number, station?: { name: string } }',
      hasEffect: false,
      mock: () => ({ tempC: 21 }),
    },
  });
});

function doc(nodes: NodeDef[], extra: Partial<Automation> = {}): Automation {
  return {
    version: 1,
    name: 'types-probe',
    nodes,
    output: `{{ nodes.${nodes.at(-1)?.id ?? 'x'}.output }}`,
    ...extra,
  };
}

async function issues(
  d: Automation,
  code: string,
  opts: ValidateOptions = {},
): Promise<Issue[]> {
  const { errors, warnings } = await validate(d, opts);
  return [...errors, ...warnings].filter((i) => i.code === code);
}

const calc: NodeDef = {
  id: 'calc',
  type: 'transform',
  code: 'return { count: 1, items: [{ title: "a" }] };',
};

describe('REF_UNKNOWN_FIELD', () => {
  it('names a field a node output cannot have, with the range through it', async () => {
    const d = doc([
      calc,
      {
        id: 'main',
        type: 'transform',
        input: { n: '{{ nodes.calc.output.items[0].titel.length }}' },
        code: 'return input.n;',
      },
    ]);
    const [issue] = await issues(d, 'REF_UNKNOWN_FIELD');
    expect(issue).toMatchObject({
      level: 'warning',
      at: { pointer: '/nodes/1/input/n', range: [3, 35] },
      params: {
        key: 'titel',
        suggestion: 'title',
        source: 'calc',
        closed: true,
        listWrapped: false,
      },
    });
    expect(issue.message).toContain('nodes.calc.output.items[0] has no field');
  });

  it('says a forEach output is a list', async () => {
    const d = doc([
      {
        id: 'each',
        type: 'transform',
        forEach: '{{ [1, 2] }}',
        code: 'return { n: item };',
      },
      {
        id: 'main',
        type: 'transform',
        input: { n: '{{ nodes.each.output.n }}' },
        code: 'return input.n;',
      },
    ]);
    const [issue] = await issues(d, 'REF_UNKNOWN_FIELD');
    expect(issue.params).toMatchObject({ listWrapped: true });
    expect(issue.hint).toContain('runs once per item');
  });

  it('reads nested run input keys but leaves top-level ones to INPUT_KEY_UNKNOWN', async () => {
    const d = doc(
      [
        {
          id: 'gen',
          type: 'llm',
          model: 'm',
          prompt: '{{ input.user.nmae }} / {{ input.usr }}',
        },
      ],
      {
        inputs: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: { name: { type: 'string' } },
              additionalProperties: false,
            },
          },
        },
      },
    );
    const { warnings } = await validate(d);
    const codes = warnings.map((w) => [w.code, w.params?.key]);
    expect(codes).toContainEqual(['REF_UNKNOWN_FIELD', 'nmae']);
    expect(codes).toContainEqual(['INPUT_KEY_UNKNOWN', 'usr']);
    expect(codes).not.toContainEqual(['REF_UNKNOWN_FIELD', 'usr']);
  });

  it('reads transform code input as the node mapping', async () => {
    const [issue] = await issues(
      doc([
        {
          id: 'main',
          type: 'transform',
          input: { a: 1 },
          code: 'return input.b;',
        },
      ]),
      'REF_UNKNOWN_FIELD',
    );
    expect(issue.message).toContain(`this node's input mapping has no key "b"`);
    expect(issue.hint).toContain('add "b" to this node');
  });

  it('leaves unstructured text and unknown shapes alone', async () => {
    const d = doc([
      { id: 'gen', type: 'llm', model: 'm', prompt: 'Summarize' },
      { id: 'spread', type: 'transform', code: 'return { ...input };' },
      {
        id: 'main',
        type: 'transform',
        input: {
          a: '{{ nodes.gen.output.summary }}',
          b: '{{ nodes.spread.output.anything }}',
        },
        code: 'return input;',
      },
    ]);
    const { errors, warnings } = await validate(d);
    expect(errors.map((i) => i.code)).toContain('REF_UNSTRUCTURED_PATH');
    expect(warnings.map((i) => i.code)).not.toContain('REF_UNKNOWN_FIELD');
  });
});

describe('TYPE_MISMATCH', () => {
  it('a connector input that certainly has the wrong type', async () => {
    const [issue] = await issues(
      doc([
        calc,
        {
          id: 'w',
          type: 'weather.current',
          input: {
            city: 'Berlin',
            days: 'in {{ nodes.calc.output.count }} days',
          },
        },
      ]),
      'TYPE_MISMATCH',
    );
    expect(issue.params).toMatchObject({
      consumer: 'connector-input',
      property: 'days',
      expected: 'number',
      actual: 'string',
    });
    expect(issue.at).toEqual({ pointer: '/nodes/1/input/days' });
  });

  it('stays silent where a value may fit', async () => {
    const found = await issues(
      doc([
        calc,
        {
          id: 'w',
          type: 'weather.current',
          input: {
            city: '{{ nodes.calc.output.items[0].title ?? null }}',
            days: '{{ nodes.calc.output.count }}',
          },
        },
      ]),
      'TYPE_MISMATCH',
    );
    expect(found).toEqual([]);
  });

  it('an input of the automation a subautomation node calls', async () => {
    const store = memoryStore();
    store.save('scale', {
      version: 1,
      name: 'scale',
      inputs: {
        type: 'object',
        properties: { n: { type: 'number' } },
        required: ['n'],
      },
      nodes: [{ id: 'x', type: 'transform', code: 'return input;' }],
      output: '{{ nodes.x.output }}',
    });
    const [issue] = await issues(
      doc([
        calc,
        {
          id: 'sub',
          type: 'subautomation',
          automation: 'scale',
          input: { n: '{{ nodes.calc.output.items }}' },
        },
      ]),
      'TYPE_MISMATCH',
      { store },
    );
    expect(issue.params).toMatchObject({
      consumer: 'subautomation-input',
      automation: 'scale',
      expected: 'number',
    });
  });

  it('a forEach over an object, pointing at its one list', async () => {
    const [issue] = await issues(
      doc([
        calc,
        {
          id: 'each',
          type: 'transform',
          forEach: '{{ nodes.calc.output }}',
          code: 'return item;',
        },
      ]),
      'TYPE_MISMATCH',
    );
    expect(issue.params).toMatchObject({
      consumer: 'forEach',
      suggestion: 'items',
    });
  });
});

describe('TEMPLATE_NULL_INTERPOLATION', () => {
  const gen: NodeDef = {
    id: 'gen',
    type: 'llm',
    model: 'm',
    prompt: 'Name it.',
    outputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        note: { type: ['string', 'null'] },
      },
      required: ['note'],
    },
  };

  it('an optional field inside text', async () => {
    const [issue] = await issues(
      doc([
        gen,
        {
          id: 'post',
          type: 'llm',
          model: 'm',
          prompt: 'About {{ nodes.gen.output.title }}.',
        },
      ]),
      'TEMPLATE_NULL_INTERPOLATION',
    );
    expect(issue.params).toMatchObject({ why: 'optional', key: 'title' });
  });

  it('a declared null inside text', async () => {
    const [issue] = await issues(
      doc([
        gen,
        {
          id: 'post',
          type: 'llm',
          model: 'm',
          prompt: 'Note: {{ nodes.gen.output.note }}',
        },
      ]),
      'TEMPLATE_NULL_INTERPOLATION',
    );
    expect(issue.params).toMatchObject({ why: 'nullable' });
  });

  it('not with a fallback, not as a whole template, not for an unknown shape', async () => {
    const found = await issues(
      doc([
        gen,
        {
          id: 'post',
          type: 'llm',
          model: 'm',
          prompt: "About {{ nodes.gen.output.title ?? 'it' }}.",
          system: '{{ nodes.gen.output.title }}',
        },
        {
          id: 'w',
          type: 'weather.current',
          input: { city: 'At {{ input.city }}' },
        },
      ]),
      'TEMPLATE_NULL_INTERPOLATION',
    );
    expect(found).toEqual([]);
  });
});
