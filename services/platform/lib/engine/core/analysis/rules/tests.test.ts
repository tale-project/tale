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
      '.count',
      'string',
      'number',
    ],
    [
      'a list item of the wrong kind',
      { rows: [5] },
      '.rows[0]',
      'number',
      '{ id: string }',
    ],
    [
      'a key the output never has',
      { total: 1 },
      '.total',
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

/** The codes of the test-family issues a document raises, in order. */
async function testCodes(d: unknown): Promise<string[]> {
  const { errors, warnings } = await validate(d);
  return [...errors, ...warnings]
    .map((i) => i.code)
    .filter((code) => code.startsWith('TESTS_'));
}

/** A document whose tests are written as given, even where they leave the
 * grammar. */
function rawDoc(
  nodes: NodeDef[],
  tests: unknown[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    name: 'tests-probe',
    nodes,
    output: `{{ nodes.${nodes.at(-1)?.id ?? 'x'}.output }}`,
    tests,
    ...extra,
  };
}

/** check → (big | small, its alternative), and a node that never runs. */
const BRANCHES: NodeDef[] = [
  {
    id: 'big',
    type: 'transform',
    when: '{{ input.n > 10 }}',
    code: 'return "big";',
  },
  { id: 'small', type: 'transform', elseOf: 'big', code: 'return "small";' },
  {
    id: 'notify',
    type: 'mail.send',
    input: { to: 'a@b.test' },
    onError: 'continue',
  },
  {
    id: 'summary',
    type: 'transform',
    input: { big: '{{ nodes.big.output }}' },
    code: 'return input.big ?? "none";',
  },
];

const BRANCH_EXTRA = {
  inputs: { type: 'object', properties: { n: { type: 'number' } } },
  output: {
    size: '{{ nodes.big.output ?? nodes.small.output }}',
    summary: '{{ nodes.summary.output ?? null }}',
  },
};

describe('the test grammar', () => {
  it('a test written with every part of the grammar raises nothing', async () => {
    const d = doc(
      BRANCHES,
      [
        {
          name: 'a big order notifies',
          description: 'the happy path',
          input: { n: 20 },
          mocks: { summary: 'big' },
          failures: { notify: 'the mailbox is full' },
          expect: {
            outputIncludes: { size: 'big' },
            effects: [
              { connector: 'mail.send', node: 'notify', inputIncludes: {} },
              { connector: 'llm', absent: true },
            ],
            nodes: { big: 'ran', small: 'skipped', notify: 'failed' },
          },
        },
        {
          name: 'a small order fails nowhere',
          input: { n: 1 },
          expect: { failure: { node: 'notify', message: 'full' } },
        },
      ],
      BRANCH_EXTRA,
    );
    // The second test expects a failure at a node that continues on error:
    // that is the one finding.
    expect(await testCodes(d)).toEqual(['TESTS_EXPECT_FAILURE_IMPOSSIBLE']);
  });
});

describe('TESTS_TOO_MANY', () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ name: `t${i}`, input: {} }));

  it('more than 50 tests is an error', async () => {
    const [issue] = await issues(doc([send], many(51)), 'TESTS_TOO_MANY');
    expect(issue).toMatchObject({
      level: 'error',
      at: { pointer: '/tests' },
      params: { count: 51, max: 50 },
    });
  });

  it('50 tests are fine', async () => {
    expect(await issues(doc([send], many(50)), 'TESTS_TOO_MANY')).toEqual([]);
  });
});

describe('TESTS_UNKNOWN_FIELD', () => {
  it('a field outside the grammar, with the one it resembles', async () => {
    const { warnings } = await validate(
      rawDoc([send], [{ name: 'typo', input: {}, mock: {}, owner: 'Ada' }]),
    );
    const found = warnings.filter((i) => i.code === 'TESTS_UNKNOWN_FIELD');
    expect(found.map((i) => [i.at, i.params])).toEqual([
      [
        { pointer: '/tests/0/mock', subject: 'key' },
        { test: 0, name: 'typo', field: 'mock', suggestion: 'mocks' },
      ],
      [
        { pointer: '/tests/0/owner', subject: 'key' },
        { test: 0, name: 'typo', field: 'owner' },
      ],
    ]);
    expect(found.every((i) => i.level === 'warning')).toBe(true);
  });

  it('a field of an expected effect outside the grammar, which would change what the test checks', async () => {
    // Each typo is ignored when the test is judged: the first entry would
    // pass on any mail, the second would pass although a mail was sent.
    const { warnings } = await validate(
      rawDoc(
        [send],
        [
          {
            name: 'typos',
            input: {},
            expect: {
              effects: [
                { connector: 'mail.send', inputInclude: { to: 'x@b.test' } },
                { connector: 'mail.send', absnt: true, owner: 'Ada' },
              ],
            },
          },
        ],
      ),
    );
    const found = warnings.filter((i) => i.code === 'TESTS_UNKNOWN_FIELD');
    expect(found.map((i) => [i.at, i.params])).toEqual([
      [
        {
          pointer: '/tests/0/expect/effects/0/inputInclude',
          subject: 'key',
        },
        {
          test: 0,
          name: 'typos',
          field: 'inputInclude',
          effect: 0,
          suggestion: 'inputIncludes',
        },
      ],
      [
        { pointer: '/tests/0/expect/effects/1/absnt', subject: 'key' },
        {
          test: 0,
          name: 'typos',
          field: 'absnt',
          effect: 1,
          suggestion: 'absent',
        },
      ],
      [
        { pointer: '/tests/0/expect/effects/1/owner', subject: 'key' },
        { test: 0, name: 'typos', field: 'owner', effect: 1 },
      ],
    ]);
    expect(found.every((i) => i.level === 'warning')).toBe(true);
    expect(found[1]?.hint).toBe(
      'did you mean "absent"? an expected effect has connector, node, input, inputIncludes and absent',
    );
  });
});

describe('TESTS_NAME_DUPLICATE', () => {
  it('each later test of one name, pointing at the first', async () => {
    const found = await issues(
      doc(
        [send],
        [
          { name: 'same', input: {} },
          { name: 'other', input: {} },
          { name: 'same', input: {} },
          { name: 'same', input: {} },
        ],
      ),
      'TESTS_NAME_DUPLICATE',
    );
    expect(found.map((i) => i.params)).toEqual([
      { test: 2, name: 'same', firstIndex: 0 },
      { test: 3, name: 'same', firstIndex: 0 },
    ]);
  });
});

describe('stand-ins a test cannot run with', () => {
  it('TESTS_MOCK_UNKNOWN_NODE — in mocks and in failures', async () => {
    const found = await issues(
      doc(
        [send],
        [
          {
            name: 'renamed',
            input: {},
            mocks: { sendd: { id: 'x' } },
            failures: { other: 'down' },
          },
        ],
      ),
      'TESTS_MOCK_UNKNOWN_NODE',
    );
    expect(found.map((i) => [i.at, i.params])).toEqual([
      [
        { pointer: '/tests/0/mocks/sendd', subject: 'key' },
        {
          test: 0,
          name: 'renamed',
          field: 'mocks',
          node: 'sendd',
          suggestion: 'send',
          nodes: ['send'],
        },
      ],
      [
        { pointer: '/tests/0/failures/other', subject: 'key' },
        {
          test: 0,
          name: 'renamed',
          field: 'failures',
          node: 'other',
          nodes: ['send'],
        },
      ],
    ]);
  });

  it('TESTS_MOCK_CONFLICT — an output and a failure for one node', async () => {
    const [issue] = await issues(
      doc(
        [send],
        [
          {
            name: 'both',
            input: {},
            mocks: { send: { id: 'x' } },
            failures: { send: 'down' },
          },
        ],
      ),
      'TESTS_MOCK_CONFLICT',
    );
    expect(issue).toMatchObject({
      at: { pointer: '/tests/0/failures/send', subject: 'key' },
      params: { test: 0, name: 'both', node: 'send' },
    });
  });
});

describe('stand-ins of the wrong shape', () => {
  const each: NodeDef = {
    id: 'each',
    type: 'mail.send',
    forEach: '{{ input.to }}',
    input: { to: '{{ item }}' },
  };
  const extra = {
    inputs: {
      type: 'object',
      properties: { to: { type: 'array', items: { type: 'string' } } },
    },
  };

  it('TESTS_MOCK_NOT_LIST — a node that runs per item needs a list', async () => {
    const [issue] = await issues(
      doc(
        [each],
        [{ name: 'one', input: { to: ['a'] }, mocks: { each: { id: 'x' } } }],
        extra,
      ),
      'TESTS_MOCK_NOT_LIST',
    );
    expect(issue).toMatchObject({
      at: { pointer: '/tests/0/mocks/each' },
      params: { test: 0, name: 'one', node: 'each', kind: 'object' },
    });
  });

  it('TESTS_MOCK_TYPE — per entry of a list, and where a node returns another kind', async () => {
    const listed = await issues(
      doc(
        [each],
        [
          {
            name: 'two',
            input: { to: ['a', 'b'] },
            mocks: { each: [{ id: 'x' }, { id: 7 }] },
          },
        ],
        extra,
      ),
      'TESTS_MOCK_TYPE',
    );
    expect(listed.map((i) => [i.at, i.params])).toEqual([
      [
        { pointer: '/tests/0/mocks/each/1/id' },
        {
          test: 0,
          name: 'two',
          node: 'each',
          property: '[1].id',
          expected: 'string',
          actual: 'number',
        },
      ],
    ]);
    expect(
      await issues(
        doc(
          [send],
          [{ name: 'fits', input: {}, mocks: { send: { id: 'x' } } }],
        ),
        'TESTS_MOCK_TYPE',
      ),
    ).toEqual([]);
  });

  it('TESTS_MOCK_TYPE — a stand-in may carry more than the type lists, as a real answer does', async () => {
    // A service answers more than a connector's signature names, and a
    // stand-in copied from a real run carries all of it: only a member of
    // another kind than the type says is a wrong shape.
    const nodes: NodeDef[] = [
      send,
      { id: 'ask', type: 'llm', model: 'm', prompt: 'Hi' },
      { id: 'calc', type: 'transform', code: 'return { count: 1 };' },
    ];
    expect(
      await issues(
        doc(nodes, [
          {
            name: 'real answers',
            input: {},
            mocks: {
              send: { id: 'x', threadId: 't-1', labels: ['sent'] },
              ask: { text: 'Hello', usage: { tokens: 3 } },
              calc: { count: 2, note: 'from a run' },
            },
          },
        ]),
        'TESTS_MOCK_TYPE',
      ),
    ).toEqual([]);
    const [issue] = await issues(
      doc(nodes, [
        {
          name: 'a number for a text',
          input: {},
          mocks: { send: { id: 7, threadId: 't-1' } },
        },
      ]),
      'TESTS_MOCK_TYPE',
    );
    expect(issue).toMatchObject({
      at: { pointer: '/tests/0/mocks/send/id' },
      params: { node: 'send', expected: 'string', actual: 'number' },
    });
  });
});

describe('TESTS_EXPECT_NODE_UNKNOWN', () => {
  it('a node named in expect.nodes, an expected effect or the expected failure', async () => {
    const found = await issues(
      doc(
        [send],
        [
          {
            name: 'names',
            input: {},
            expect: {
              nodes: { snd: 'ran' },
              effects: [
                { connector: 'mail.send', node: 'mailer' },
                { connector: 'mail.send', node: 'send/inner' },
              ],
            },
          },
          {
            name: 'fails',
            input: {},
            expect: { failure: { node: 'gone' } },
          },
        ],
      ),
      'TESTS_EXPECT_NODE_UNKNOWN',
    );
    expect(found.map((i) => [i.at?.pointer, i.params?.node])).toEqual([
      ['/tests/0/expect/nodes/snd', 'snd'],
      ['/tests/0/expect/effects/0/node', 'mailer'],
      ['/tests/1/expect/failure/node', 'gone'],
    ]);
    expect(found[0]?.params?.suggestion).toBe('send');
  });
});

describe('TESTS_EXPECT_PATH_IMPOSSIBLE', () => {
  const judged = async (
    nodes: Record<string, string>,
    extra: Partial<AutomationTest> = {},
  ) =>
    await issues(
      doc(
        BRANCHES,
        [
          {
            name: 'paths',
            input: { n: 1 },
            expect: { nodes: nodes as never },
            ...extra,
          },
        ],
        BRANCH_EXTRA,
      ),
      'TESTS_EXPECT_PATH_IMPOSSIBLE',
    );

  it('two nodes that never run in one run', async () => {
    const [issue] = await judged({ big: 'ran', small: 'ran' });
    expect(issue).toMatchObject({
      at: { pointer: '/tests/0/expect/nodes' },
      params: { reason: 'never-together', a: 'big', b: 'small' },
    });
  });

  it('a node that cannot fail and let the run go on', async () => {
    const [issue] = await judged({ summary: 'failed' });
    expect(issue).toMatchObject({
      at: { pointer: '/tests/0/expect/nodes/summary' },
      params: { reason: 'cannot-fail', node: 'summary' },
    });
  });

  it('a node that runs on every path, expected skipped', async () => {
    const [issue] = await judged({ notify: 'skipped' });
    expect(issue?.params).toMatchObject({
      reason: 'always-runs',
      node: 'notify',
    });
  });

  it('a node that never runs, expected to run', async () => {
    const found = await issues(
      doc(
        [
          send,
          {
            id: 'never',
            type: 'transform',
            when: '{{ false }}',
            code: 'return 1;',
          },
        ],
        [{ name: 'never', input: {}, expect: { nodes: { never: 'ran' } } }],
        { output: '{{ nodes.send.output }}' },
      ),
      'TESTS_EXPECT_PATH_IMPOSSIBLE',
    );
    expect(found[0]?.params).toMatchObject({
      reason: 'never-runs',
      node: 'never',
    });
  });

  it('is silent where some run does it — with the failures the test simulates', async () => {
    expect(
      await judged({ big: 'skipped', small: 'ran', summary: 'skipped' }),
    ).toEqual([]);
    // summary reads big: it never runs while big is skipped.
    expect(
      (await judged({ big: 'skipped', small: 'ran', summary: 'ran' }))[0]
        ?.params,
    ).toMatchObject({ reason: 'never-together', a: 'small', b: 'summary' });
    expect(
      await judged({ notify: 'failed' }, { failures: { notify: 'full' } }),
    ).toEqual([]);
  });

  it('a node expected to fail and go on, whose simulated failure stops the run', async () => {
    const [issue] = await judged(
      { summary: 'failed' },
      { failures: { summary: 'the service is down' } },
    );
    expect(issue).toMatchObject({
      at: { pointer: '/tests/0/expect/nodes/summary' },
      params: { reason: 'cannot-fail', node: 'summary' },
    });
  });

  it('names the simulated failure that rules out what the test expects', async () => {
    const nodes: NodeDef[] = [
      { ...send, id: 'ping', onError: 'continue' },
      {
        id: 'after',
        type: 'transform',
        input: { id: '{{ nodes.ping.output.id }}' },
        code: 'return input.id;',
      },
    ];
    const found = await issues(
      doc(nodes, [
        {
          name: 'reads the mail',
          input: {},
          failures: { ping: 'down' },
          expect: { nodes: { after: 'ran' } },
        },
        {
          name: 'sends the mail',
          input: {},
          failures: { ping: 'down' },
          expect: { nodes: { ping: 'ran' } },
        },
      ]),
      'TESTS_EXPECT_PATH_IMPOSSIBLE',
    );
    // Both nodes run on some path of the automation: it is the test's own
    // simulated failure that rules each expectation out.
    expect(found.map((i) => [i.params, i.hint])).toEqual([
      [
        {
          test: 0,
          name: 'reads the mail',
          reason: 'never-runs',
          node: 'after',
          via: 'ping',
        },
        '"after" can never run — the test simulates a failure of "ping"',
      ],
      [
        {
          test: 1,
          name: 'sends the mail',
          reason: 'never-runs',
          node: 'ping',
          via: 'ping',
        },
        '"ping" can never run — the test simulates a failure of "ping"',
      ],
    ]);
    expect(found[0]?.message).toBe(
      'tests[0] "reads the mail" expects "after" to run, which no run of this automation does while "ping" fails',
    );
  });

  it('is silent for a run that must fail, or that a simulated failure stops', async () => {
    expect(
      await judged(
        { big: 'ran', small: 'ran' },
        { expect: { failure: {}, nodes: { big: 'ran', small: 'ran' } } },
      ),
    ).toEqual([]);
    expect(
      await judged(
        { big: 'ran', small: 'ran' },
        { failures: { summary: 'down' } },
      ),
    ).toEqual([]);
  });
});

describe('TESTS_EXPECT_FAILURE_IMPOSSIBLE', () => {
  it('a node that continues on error, or that never runs', async () => {
    const found = await issues(
      doc(
        [
          { ...send, onError: 'continue' },
          {
            id: 'never',
            type: 'transform',
            when: '{{ false }}',
            code: 'return 1;',
          },
          { id: 'last', type: 'transform', code: 'return 2;' },
        ],
        [
          {
            name: 'continues',
            input: {},
            expect: { failure: { node: 'send' } },
          },
          {
            name: 'unreachable',
            input: {},
            expect: { failure: { node: 'never' } },
          },
          { name: 'fine', input: {}, expect: { failure: { node: 'last' } } },
        ],
      ),
      'TESTS_EXPECT_FAILURE_IMPOSSIBLE',
    );
    expect(found.map((i) => [i.at?.pointer, i.params?.cause])).toEqual([
      ['/tests/0/expect/failure/node', 'continues'],
      ['/tests/1/expect/failure/node', 'unreachable'],
    ]);
  });
});

describe('what the existing test rules judge of the new grammar', () => {
  it('an effect expected not to happen is never impossible', async () => {
    expect(
      await issues(
        doc(
          [send],
          [
            {
              name: 'quiet',
              input: {},
              expect: { effects: [{ connector: 'llm', absent: true }] },
            },
          ],
        ),
        'TESTS_EFFECT_UNKNOWN',
      ),
    ).toEqual([]);
  });

  it('TESTS_EXPECT_TYPE judges what the output must include', async () => {
    const [issue] = await issues(
      doc(
        [{ id: 'calc', type: 'transform', code: 'return { count: 1 };' }],
        [
          {
            name: 'shape',
            input: {},
            expect: { outputIncludes: { count: 'one' } },
          },
        ],
        { output: { count: '{{ nodes.calc.output.count }}' } },
      ),
      'TESTS_EXPECT_TYPE',
    );
    expect(issue).toMatchObject({
      at: { pointer: '/tests/0/expect/outputIncludes/count' },
      params: { property: '.count', expected: 'string', actual: 'number' },
    });
  });
});
