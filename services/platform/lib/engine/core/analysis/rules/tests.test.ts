// @vitest-environment node

import { beforeAll, describe, expect, it } from 'vitest';

import { memoryStore } from '../../../selftest/memory-store';
import { registerNodeType } from '../../slots';
import type { Automation, AutomationTest, Issue, NodeDef } from '../../types';
import { validate, type ValidateOptions } from '../../validate';

beforeAll(() => {
  registerNodeType({
    type: 'mail.send',
    kind: 'connector',
    outputKind: 'structured',
    description: 'test connector: send a mail (a write)',
    allowedFields: ['input'],
    requiredFields: ['input'],
    connector: {
      name: 'mail.send',
      description: 'send a mail',
      inputSchema: {
        type: 'object',
        properties: { to: { type: 'string' } },
        required: ['to'],
      },
      outputSignature: '{ id: string }',
      hasEffect: true,
      mock: () => ({ id: 'm-1' }),
    },
  });
});

function doc(
  nodes: NodeDef[],
  tests: AutomationTest[],
  extra: Partial<Automation> = {},
): Automation {
  return {
    version: 1,
    name: 'tests-probe',
    nodes,
    output: `{{ nodes.${nodes.at(-1)?.id ?? 'x'}.output }}`,
    tests,
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

const send: NodeDef = {
  id: 'send',
  type: 'mail.send',
  input: { to: 'a@b.test' },
};

describe('TESTS_INPUT_INVALID', () => {
  it('a test input the inputs schema refuses', async () => {
    const [issue] = await issues(
      doc([send], [{ name: 'empty', input: { cty: 'Bern' } }], {
        inputs: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
          additionalProperties: false,
        },
      }),
      'TESTS_INPUT_INVALID',
    );
    expect(issue).toMatchObject({
      level: 'warning',
      at: { pointer: '/tests/0/input' },
      params: {
        test: 0,
        name: 'empty',
        missing: ['city'],
        problems: [
          'city is required',
          'cty is not a field the inputs schema takes',
        ],
      },
    });
  });

  it('no inputs schema accepts any input', async () => {
    expect(
      await issues(
        doc([send], [{ name: 'any', input: { x: 1 } }]),
        'TESTS_INPUT_INVALID',
      ),
    ).toEqual([]);
  });
});

describe('TESTS_EFFECT_UNKNOWN', () => {
  it('an effect no node performs, with the closest one', async () => {
    const [issue] = await issues(
      doc(
        [{ id: 'gen', type: 'llm', model: 'm', prompt: 'Hi' }, send],
        [
          {
            name: 'mails',
            input: {},
            expect: {
              effects: [{ connector: 'llm' }, { connector: 'mail.sent' }],
            },
          },
        ],
      ),
      'TESTS_EFFECT_UNKNOWN',
    );
    expect(issue).toMatchObject({
      at: { pointer: '/tests/0/expect/effects/1/connector' },
      params: {
        connector: 'mail.sent',
        suggestion: 'mail.send',
        possible: ['llm', 'mail.send'],
      },
    });
  });

  it('counts the effects of a called automation', async () => {
    const store = memoryStore();
    store.save('notify', {
      version: 1,
      name: 'notify',
      nodes: [send],
      output: '{{ nodes.send.output }}',
    });
    const d = doc(
      [{ id: 'sub', type: 'subautomation', automation: 'notify' }],
      [
        {
          name: 'notifies',
          input: {},
          expect: { effects: [{ connector: 'mail.send' }] },
        },
      ],
    );
    expect(await issues(d, 'TESTS_EFFECT_UNKNOWN', { store })).toEqual([]);
    // Without a store the called automation is unknown, and so are its
    // effects: nothing is claimed.
    expect(await issues(d, 'TESTS_EFFECT_UNKNOWN')).toEqual([]);
  });
});

describe('TESTS_EXPECT_TYPE', () => {
  const calc: NodeDef = {
    id: 'calc',
    type: 'transform',
    code: 'return { count: 1, rows: [{ id: "a" }] };',
  };
  const output = {
    count: '{{ nodes.calc.output.count }}',
    rows: '{{ nodes.calc.output.rows }}',
  };

  it.each<[string, unknown, string, string, string]>([
    [
      'a number expected as text',
      { count: 'one' },
      'count',
      'string',
      'number',
    ],
    [
      'a list item of the wrong kind',
      { rows: [5] },
      'rows[0]',
      'number',
      '{ id: string }',
    ],
    [
      'a key the output never has',
      { total: 1 },
      'total',
      'number',
      'undefined',
    ],
  ])('%s', async (_, expected, property, want, have) => {
    const [issue] = await issues(
      doc(
        [calc],
        [{ name: 'shape', input: {}, expect: { output: expected } }],
        {
          output,
        },
      ),
      'TESTS_EXPECT_TYPE',
    );
    expect(issue.params).toMatchObject({
      property,
      expected: want,
      actual: have,
    });
  });

  it('accepts matching kinds and an expected null, which a skip can produce', async () => {
    expect(
      await issues(
        doc(
          [calc],
          [
            {
              name: 'fits',
              input: {},
              expect: { output: { count: 2, rows: [{ id: 'b' }] } },
            },
            { name: 'skipped', input: {}, expect: { output: { count: null } } },
          ],
          { output },
        ),
        'TESTS_EXPECT_TYPE',
      ),
    ).toEqual([]);
  });
});
