// @vitest-environment node

/**
 * A run turns into a test that replays it: the run's input, what it
 * returned or that it must succeed (by how it ended), and the calling nodes
 * answering as they answered in the run — run by the engine, such a test
 * passes on the automation the run ran, and a failed run's test fails until
 * the failure is handled. Nothing is copied silently: secrets are withheld
 * and listed, what does not fit a document is dropped or said, and a live
 * run's calls the test does not stand in for are named.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { runAutomationTests } from '../../engine/api/tests';
import { execute } from '../../engine/core/execute';
import type { ValueRedaction } from '../../engine/core/record/types';
import { registerNodeType, setCodeRunner } from '../../engine/core/slots';
import type { Automation, AutomationTest } from '../../engine/core/types';
import { validate } from '../../engine/core/validate';
import { nodeVmRunner } from '../../engine/runners/node-vm';
import {
  BENCH_LIMITS,
  type TestFromRunWarning,
  testFromRunSchema,
} from '../../shared/schemas/automation-tests';
import {
  defaultExpect,
  expectChoices,
  type RunForTest,
  simulationCandidates,
  TEST_FROM_RUN_LIMITS,
  testFromRun,
} from './test-from-run';

/** Whether two types are the same type. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
  registerNodeType({
    type: 'crm.fetch',
    kind: 'connector',
    outputKind: 'structured',
    description: 'test connector: reads a customer',
    allowedFields: ['input'],
    requiredFields: ['input'],
    connector: {
      name: 'crm.fetch',
      description: 'read a customer',
      inputSchema: { type: 'object' },
      outputSignature:
        '{ customer: { id: string, name: string, tier: string } }',
      hasEffect: false,
      mock: () => ({
        customer: { id: 'mock-customer', name: 'Mock', tier: 'free' },
      }),
    },
  });
  registerNodeType({
    type: 'mail.send',
    kind: 'connector',
    outputKind: 'structured',
    description: 'test connector: sends a mail',
    allowedFields: ['input'],
    requiredFields: ['input'],
    connector: {
      name: 'mail.send',
      description: 'send a mail',
      inputSchema: { type: 'object' },
      outputSignature: '{ sent: boolean }',
      hasEffect: true,
      mock: () => ({ sent: true }),
    },
  });
});

const WELCOME: Automation = {
  version: 1,
  name: 'welcome-customer',
  inputs: {
    type: 'object',
    properties: { customerId: { type: 'string' } },
    required: ['customerId'],
  },
  nodes: [
    { id: 'fetch', type: 'crm.fetch', input: { id: '{{ input.customerId }}' } },
    {
      id: 'greet',
      type: 'llm',
      model: 'openai/gpt-4o',
      prompt: 'Greet {{ nodes.fetch.output.customer.name }}',
    },
    {
      id: 'shape',
      type: 'transform',
      input: {
        tier: '{{ nodes.fetch.output.customer.tier }}',
        text: '{{ nodes.greet.output.text }}',
      },
      code: 'return { tier: input.tier, text: input.text };',
    },
    {
      id: 'send',
      type: 'mail.send',
      input: { body: '{{ nodes.shape.output.text }}' },
    },
  ],
  output: '{{ nodes.shape.output }}',
};

const STARTED_AT = Date.UTC(2026, 9, 10, 8, 3);

/** A checkpoint entry as the durable runner stores a step. */
function done(node: string, type: string, output: unknown) {
  return {
    status: 'ok',
    output,
    trace: { node, type, status: 'ok' },
    effects: [],
  };
}

/** A live run of WELCOME that succeeded, as its row stores it. */
const LIVE: RunForTest = {
  mode: 'live',
  status: 'success',
  input: { customerId: 'c-42' },
  output: { tier: 'gold', text: 'Hello Ada' },
  checkpoints: {
    nodes: {
      fetch: done('fetch', 'crm.fetch', {
        customer: { id: 'c-42', name: 'Ada', tier: 'gold' },
      }),
      greet: done('greet', 'llm', { text: 'Hello Ada' }),
      shape: done('shape', 'transform', { tier: 'gold', text: 'Hello Ada' }),
      send: done('send', 'mail.send', { sent: true, id: 'm-1' }),
    },
    executions: 4,
  },
  effects: [
    { node: 'greet', connector: 'llm', input: { prompt: 'Greet Ada' } },
    { node: 'send', connector: 'mail.send', input: { body: 'Hello Ada' } },
  ],
  startedAt: STARTED_AT,
};

/** A live run of WELCOME that failed sending its mail. */
const FAILED: RunForTest = {
  mode: 'live',
  status: 'failed',
  input: { customerId: 'c-42' },
  checkpoints: {
    nodes: {
      fetch: done('fetch', 'crm.fetch', {
        customer: { id: 'c-42', name: 'Ada', tier: 'gold' },
      }),
      greet: done('greet', 'llm', { text: 'Hello Ada' }),
      shape: done('shape', 'transform', { tier: 'gold', text: 'Hello Ada' }),
    },
    executions: 4,
  },
  trace: [
    {
      node: 'send',
      type: 'mail.send',
      status: 'error',
      error: 'SMTP 550: mailbox unavailable',
    },
  ],
  error: { nodeId: 'send', message: 'SMTP 550: mailbox unavailable' },
  startedAt: STARTED_AT,
};

/** The one result of `test` run by the engine on `automation`. */
async function judged(automation: Automation, test: AutomationTest) {
  const report = await runAutomationTests({ ...automation, tests: [test] });
  if (!('results' in report)) throw new Error(report.error);
  const [result] = report.results;
  if (result === undefined) throw new Error('no result');
  return result;
}

/** A value as it travels: JSON, nothing `undefined` left in it. */
function wire<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe('a run that succeeded', () => {
  it('offers its calling nodes to stand in, code never', () => {
    expect(simulationCandidates(LIVE, WELCOME)).toEqual([
      expect.objectContaining({
        node: 'fetch',
        type: 'crm.fetch',
        standIn: 'output',
        defaultOn: true,
      }),
      expect.objectContaining({ node: 'greet', type: 'llm', defaultOn: true }),
      expect.objectContaining({
        node: 'shape',
        type: 'transform',
        defaultOn: false,
        disabledReason: 'transform',
      }),
      expect.objectContaining({
        node: 'send',
        type: 'mail.send',
        defaultOn: true,
      }),
    ]);
  });

  it('expects its output and replays its calls by default — and passes', async () => {
    const built = testFromRun({ run: LIVE, document: WELCOME });
    expect(built).toEqual({
      test: {
        name: 'From the run of 2026-10-10 08:03 UTC',
        input: { customerId: 'c-42' },
        mocks: {
          fetch: { customer: { id: 'c-42', name: 'Ada', tier: 'gold' } },
          greet: { text: 'Hello Ada' },
          send: { sent: true, id: 'm-1' },
        },
        expect: { output: { tier: 'gold', text: 'Hello Ada' } },
      },
      dropped: [],
      warnings: [],
    });
    expect(testFromRunSchema.parse(wire(built))).toEqual(wire(built));
    expect((await judged(WELCOME, built.test)).pass).toBe(true);
  });

  it('expects what the output includes, or only that the run succeeds', () => {
    expect(
      testFromRun({
        run: LIVE,
        document: WELCOME,
        options: { expect: 'includes' },
      }).test.expect,
    ).toEqual({ outputIncludes: { tier: 'gold', text: 'Hello Ada' } });
    for (const asked of ['succeeds', 'none'] as const) {
      expect(
        testFromRun({
          run: LIVE,
          document: WELCOME,
          options: { expect: asked },
        }).test.expect,
      ).toBeUndefined();
    }
  });

  it('names the calls a live run made that the test does not stand in for — and they answer otherwise', async () => {
    const built = testFromRun({
      run: LIVE,
      document: WELCOME,
      options: { simulate: ['send'] },
    });
    expect(built.warnings).toEqual([
      { kind: 'live-run-needs-stand-ins', nodes: ['fetch', 'greet'] },
    ]);
    expect((await judged(WELCOME, built.test)).pass).toBe(false);
    const mocked = testFromRun({
      run: { ...LIVE, mode: 'mock' },
      document: WELCOME,
      options: { simulate: [] },
    });
    expect(mocked.warnings).toEqual([]);
  });

  it('expects each action once, by node and connector, when asked', () => {
    const run: RunForTest = {
      ...LIVE,
      effects: [
        ...(LIVE.effects ?? []),
        {
          node: 'send',
          connector: 'mail.send',
          input: { body: 'again' },
          item: 1,
        },
        { node: 'gone', connector: 'mail.send', input: {} },
      ],
    };
    expect(
      testFromRun({ run, document: WELCOME, options: { expectActions: true } })
        .test.expect?.effects,
    ).toEqual([
      { connector: 'llm', node: 'greet' },
      { connector: 'mail.send', node: 'send' },
    ]);
  });

  it('builds the same test from a run made in one call, its trace for its steps', async () => {
    const result = await execute(WELCOME, {
      input: { customerId: 'c-7' },
      mode: 'mock',
    });
    const built = testFromRun({
      run: {
        mode: 'mock',
        status: result.status,
        input: { customerId: 'c-7' },
        output: result.output,
        trace: result.trace,
        effects: result.effects,
        startedAt: STARTED_AT,
      },
      document: WELCOME,
      options: { expectActions: true },
    });
    expect(Object.keys(built.test.mocks ?? {})).toEqual([
      'fetch',
      'greet',
      'send',
    ]);
    expect(built.test.expect?.output).toEqual(result.output);
    expect((await judged(WELCOME, built.test)).pass).toBe(true);
  });
});

describe('a run that failed', () => {
  it('expects success by default — a test that fails until the failure is handled', async () => {
    expect(defaultExpect(FAILED, WELCOME)).toBe('succeeds');
    expect(expectChoices(FAILED, WELCOME)).toEqual([
      'succeeds',
      'fails-here',
      'none',
    ]);
    const built = testFromRun({ run: FAILED, document: WELCOME });
    expect(built.test).toEqual({
      name: 'From the run of 2026-10-10 08:03 UTC',
      input: { customerId: 'c-42' },
      mocks: {
        fetch: { customer: { id: 'c-42', name: 'Ada', tier: 'gold' } },
        greet: { text: 'Hello Ada' },
      },
      failures: { send: 'SMTP 550: mailbox unavailable' },
    });
    expect(built.warnings).toEqual([]);
    const result = await judged(WELCOME, built.test);
    expect(result.pass).toBe(false);
    expect(result.failures?.[0]).toMatchObject({
      kind: 'run_failed',
      node: 'send',
    });
    const handled: Automation = {
      ...WELCOME,
      nodes: WELCOME.nodes.map((node) =>
        node.id === 'send' ? { ...node, onError: 'continue' } : node,
      ),
    };
    expect((await judged(handled, built.test)).pass).toBe(true);
  });

  it('expects the failure where it happened, when asked — and passes', async () => {
    const built = testFromRun({
      run: FAILED,
      document: WELCOME,
      options: { expect: 'fails-here' },
    });
    expect(built.test.expect).toEqual({ failure: { node: 'send' } });
    expect((await judged(WELCOME, built.test)).pass).toBe(true);
  });

  it('keeps a failure the run went on from, without what a test added to its words', () => {
    const run: RunForTest = {
      ...LIVE,
      checkpoints: {
        nodes: {
          ...(LIVE.checkpoints as { nodes: Record<string, unknown> }).nodes,
          send: {
            status: 'skipped',
            reason: 'error',
            output: null,
            trace: {
              node: 'send',
              type: 'mail.send',
              status: 'error',
              error: 'timeout (simulated by the test)',
            },
            effects: [],
          },
        },
        executions: 4,
      },
    };
    const built = testFromRun({ run, document: WELCOME });
    expect(built.test.failures).toEqual({ send: 'timeout' });
    expect(
      simulationCandidates(run, WELCOME).find((c) => c.node === 'send'),
    ).toMatchObject({ standIn: 'failure', defaultOn: true });
  });

  it('cuts a failure to what a document keeps', () => {
    const long = 'x'.repeat(BENCH_LIMITS.failureChars + 500);
    const built = testFromRun({
      run: { ...FAILED, trace: [], error: { nodeId: 'send', message: long } },
      document: WELCOME,
    });
    const message = built.test.failures?.send ?? '';
    expect(message).toHaveLength(BENCH_LIMITS.failureChars);
    expect(message.endsWith('…')).toBe(true);
  });

  it('cannot expect a failure at a node the document no longer has', () => {
    const run: RunForTest = {
      ...FAILED,
      error: { nodeId: 'retired', message: 'boom' },
    };
    expect(expectChoices(run, WELCOME)).toEqual(['succeeds', 'none']);
    expect(
      testFromRun({ run, document: WELCOME, options: { expect: 'fails-here' } })
        .test.expect,
    ).toBeUndefined();
  });

  it('asks nothing of the output of a run that failed, whatever is asked', () => {
    expect(
      testFromRun({
        run: FAILED,
        document: WELCOME,
        options: { expect: 'equals' },
      }).test.expect,
    ).toBeUndefined();
  });

  it('expects no action of a node it fails, nor inside a called automation it stands in for', () => {
    const document: Automation = {
      ...WELCOME,
      nodes: [
        ...WELCOME.nodes,
        { id: 'batch', type: 'subautomation', automation: 'mail/batch' },
      ],
    };
    const run: RunForTest = {
      ...FAILED,
      checkpoints: {
        nodes: {
          ...(FAILED.checkpoints as { nodes: Record<string, unknown> }).nodes,
          batch: done('batch', 'subautomation', { sent: 3 }),
        },
        executions: 5,
      },
      // `send` sent for the items before the one it failed at; the called
      // automation sent from inside it.
      effects: [
        { node: 'greet', connector: 'llm', input: {} },
        { node: 'batch/send', connector: 'mail.send', input: {} },
        { node: 'send', connector: 'mail.send', input: {}, item: 0 },
      ],
    };
    const options = { expectActions: true, expect: 'fails-here' as const };
    expect(
      testFromRun({ run, document, options }).test.expect?.effects,
    ).toEqual([{ connector: 'llm', node: 'greet' }]);
    expect(
      testFromRun({
        run,
        document,
        options: { ...options, simulate: ['fetch', 'greet'] },
      }).test.expect?.effects,
    ).toEqual([
      { connector: 'llm', node: 'greet' },
      { connector: 'mail.send', node: 'batch/send' },
      { connector: 'mail.send', node: 'send' },
    ]);
  });
});

describe('a run that has not ended', () => {
  it('expects nothing by default, and may only expect success', () => {
    const run: RunForTest = { ...LIVE, status: 'cancelled', output: undefined };
    expect(defaultExpect(run, WELCOME)).toBe('none');
    expect(expectChoices(run, WELCOME)).toEqual(['succeeds', 'none']);
    expect(testFromRun({ run, document: WELCOME }).test.expect).toBeUndefined();
  });
});

describe('secrets in a run', () => {
  const token = `ghp_${'a1'.repeat(15)}`;
  const key = `sk-${'b2'.repeat(12)}`;
  const run: RunForTest = {
    ...FAILED,
    input: { customerId: 'c-42', apiKey: key },
    checkpoints: {
      nodes: {
        fetch: done('fetch', 'crm.fetch', {
          customer: { id: 'c-42', name: 'Ada', tier: 'gold', note: token },
          password: 'hunter2',
        }),
        greet: done('greet', 'llm', { text: 'Hello Ada' }),
      },
      executions: 2,
    },
    error: { nodeId: 'send', message: `refused ${token}` },
    trace: [],
  };

  it('withholds each one and says where', () => {
    const built = testFromRun({ run, document: WELCOME });
    expect(built.test.input).toEqual({ customerId: 'c-42', apiKey: null });
    expect(built.test.mocks?.fetch).toEqual({
      customer: { id: 'c-42', name: 'Ada', tier: 'gold', note: null },
      password: null,
    });
    expect(built.test.failures).toEqual({ send: '' });
    const [warning] = built.warnings;
    expect(warning).toEqual({
      kind: 'redacted',
      places: [
        { pointer: '/input/apiKey', why: 'key' },
        { pointer: '/mocks/fetch/customer/note', why: 'pattern' },
        { pointer: '/mocks/fetch/password', why: 'key' },
        { pointer: '/failures/send', why: 'pattern' },
      ],
      total: 4,
    });
    expect(testFromRunSchema.parse(wire(built))).toEqual(wire(built));
  });

  it('leaves the document check nothing to refuse', async () => {
    const built = testFromRun({ run, document: WELCOME });
    const secretsIn = async (test: unknown) =>
      (await validate({ ...WELCOME, tests: [test] })).errors.filter(
        (issue) => issue.code === 'SECRET_IN_DOCUMENT',
      );
    expect(await secretsIn(built.test)).toEqual([]);
    expect(
      (
        await secretsIn({
          ...built.test,
          input: { customerId: 'c-42', apiKey: key },
        })
      ).length,
    ).toBeGreaterThan(0);
  });

  it('says how the places are named, as the run record names them', () => {
    const why: Equal<
      Extract<
        TestFromRunWarning,
        { kind: 'redacted' }
      >['places'][number]['why'],
      ValueRedaction['why']
    > = true;
    const reasons: Equal<
      z.infer<typeof testFromRunSchema>['dropped'][number]['reason'],
      'too_large' | 'not_in_document' | 'transform' | 'no_output'
    > = true;
    expect([why, reasons]).toEqual([true, true]);
  });
});

describe('what a document keeps', () => {
  const big = (bytes: number) => ({ blob: 'z'.repeat(bytes) });

  it('drops a stand-in larger than a document keeps, and offers it disabled', () => {
    const run: RunForTest = {
      ...LIVE,
      checkpoints: {
        nodes: {
          ...(LIVE.checkpoints as { nodes: Record<string, unknown> }).nodes,
          fetch: done(
            'fetch',
            'crm.fetch',
            big(TEST_FROM_RUN_LIMITS.valueBytes),
          ),
        },
        executions: 4,
      },
    };
    const fetch = simulationCandidates(run, WELCOME).find(
      (c) => c.node === 'fetch',
    );
    expect(fetch).toMatchObject({
      defaultOn: false,
      disabledReason: 'too_large',
    });
    expect(fetch?.bytes).toBeGreaterThan(TEST_FROM_RUN_LIMITS.valueBytes);
    const byDefault = testFromRun({ run, document: WELCOME });
    expect(byDefault.test.mocks).not.toHaveProperty('fetch');
    expect(byDefault.warnings).toEqual([
      { kind: 'live-run-needs-stand-ins', nodes: ['fetch'] },
    ]);
    expect(
      testFromRun({ run, document: WELCOME, options: { simulate: ['fetch'] } })
        .dropped,
    ).toEqual([{ node: 'fetch', reason: 'too_large' }]);
  });

  it('expects success rather than an output larger than a document keeps', () => {
    const run: RunForTest = {
      ...LIVE,
      output: big(TEST_FROM_RUN_LIMITS.valueBytes),
    };
    expect(expectChoices(run, WELCOME)).toEqual(['succeeds', 'none']);
    expect(defaultExpect(run, WELCOME)).toBe('succeeds');
    const built = testFromRun({
      run,
      document: WELCOME,
      options: { expect: 'equals' },
    });
    expect(built.test.expect).toBeUndefined();
    expect(built.warnings).toEqual([
      expect.objectContaining({ kind: 'too-large', part: 'output' }),
    ]);
  });

  it('keeps a large input and a large test, and says so', () => {
    const half = TEST_FROM_RUN_LIMITS.valueBytes - 1_000;
    const run: RunForTest = {
      ...LIVE,
      input: { customerId: 'c-42', ...big(100_000) },
      checkpoints: {
        nodes: {
          fetch: done('fetch', 'crm.fetch', big(half)),
          greet: done('greet', 'llm', big(half)),
          send: done('send', 'mail.send', big(half)),
        },
        executions: 3,
      },
    };
    const built = testFromRun({ run, document: WELCOME });
    expect(Object.keys(built.test.mocks ?? {})).toEqual([
      'fetch',
      'greet',
      'send',
    ]);
    expect(built.warnings.map((w) => w.kind === 'too-large' && w.part)).toEqual(
      ['input', 'test'],
    );
  });
});

describe('what cannot stand in', () => {
  it('says why for each node asked for', () => {
    const run: RunForTest = {
      ...LIVE,
      checkpoints: {
        nodes: {
          ...(LIVE.checkpoints as { nodes: Record<string, unknown> }).nodes,
          retired: done('retired', 'crm.fetch', {}),
          send: {
            status: 'skipped',
            reason: 'when',
            output: null,
            trace: { node: 'send', type: 'mail.send', status: 'skipped' },
            effects: [],
          },
        },
        executions: 4,
      },
    };
    const built = testFromRun({
      run,
      document: WELCOME,
      options: { simulate: ['retired', 'shape', 'send', 'greet', 'greet'] },
    });
    expect(built.dropped).toEqual([
      { node: 'retired', reason: 'not_in_document' },
      { node: 'shape', reason: 'transform' },
      { node: 'send', reason: 'no_output' },
    ]);
    expect(Object.keys(built.test.mocks ?? {})).toEqual(['greet']);
    expect(
      simulationCandidates(run, WELCOME).find((c) => c.node === 'retired'),
    ).toMatchObject({ disabledReason: 'not_in_document', defaultOn: false });
  });
});

describe('the name of a test made from a run', () => {
  it('is unique among the document tests, unless one is given', () => {
    const named = (tests: AutomationTest[], name?: string) =>
      testFromRun({
        run: LIVE,
        document: { ...WELCOME, tests },
        ...(name !== undefined && { options: { name } }),
      }).test.name;
    const taken = { name: 'From the run of 2026-10-10 08:03 UTC', input: {} };
    expect(named([taken])).toBe('From the run of 2026-10-10 08:03 UTC (2)');
    expect(named([taken, { ...taken, name: `${taken.name} (2)` }])).toBe(
      'From the run of 2026-10-10 08:03 UTC (3)',
    );
    expect(named([taken], taken.name)).toBe(taken.name);
  });
});
