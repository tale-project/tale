import { beforeAll, describe, expect, it } from 'vitest';

import { registerNodeType, setCodeRunner } from '../core/slots';
import type { Automation, AutomationTest } from '../core/types';
import { nodeVmRunner } from '../runners/node-vm';
import {
  runAutomationTests,
  stableStringify,
  type TestReport,
  type TestResult,
} from './tests';

/** Called by the `ping.send` mock on every call. */
let onPing: (() => void) | undefined;

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
  registerNodeType({
    type: 'ping.send',
    kind: 'connector',
    outputKind: 'structured',
    description: 'test connector: sends a ping',
    allowedFields: ['input'],
    requiredFields: ['input'],
    connector: {
      name: 'ping.send',
      description: 'send a ping',
      inputSchema: { type: 'object' },
      outputSignature: '{ ok: boolean }',
      hasEffect: true,
      mock: () => {
        onPing?.();
        return { ok: true };
      },
    },
  });
});

const DOUBLER: Automation = {
  version: 1,
  name: 'doubler',
  nodes: [
    {
      id: 'double',
      type: 'transform',
      input: { n: '{{ input.n }}' },
      code: 'return input.n * 2;',
    },
    { id: 'notify', type: 'ping.send', input: { note: 'done' } },
  ],
  output: '{{ nodes.double.output }}',
  tests: [
    { name: 'doubles 3', input: { n: 3 }, expect: { output: 6 } },
    {
      name: 'pings',
      input: { n: 1 },
      expect: {
        effects: [{ connector: 'ping.send', input: { note: 'done' } }],
      },
    },
  ],
};

function report(value: Awaited<ReturnType<typeof runAutomationTests>>) {
  if (!('results' in value)) throw new Error(`no report: ${value.error}`);
  return value;
}

/** The one result of a document run with one test. */
async function judge(
  automation: Automation,
  test: AutomationTest,
): Promise<TestResult> {
  const answer = report(
    await runAutomationTests({ ...automation, tests: [test] }),
  );
  const result = answer.results[0];
  if (result === undefined) throw new Error('no result');
  return result;
}

describe('stableStringify', () => {
  it('is key-order independent', () => {
    expect(stableStringify({ a: 1, b: [2, { d: 3, c: 4 }] })).toBe(
      stableStringify({ b: [2, { c: 4, d: 3 }], a: 1 }),
    );
  });
});

describe('runAutomationTests', () => {
  it('reports pass counts for green tests', async () => {
    const answer = report(await runAutomationTests(DOUBLER));
    expect(answer).toMatchObject({ passed: 2, failed: 0 });
    expect(answer.results.map((r) => [r.name, r.index, r.pass])).toEqual([
      ['doubles 3', 0, true],
      ['pings', 1, true],
    ]);
    expect(answer.results.every((r) => r.ms >= 0)).toBe(true);
  });

  it('reports output mismatches with both sides', async () => {
    const result = await judge(DOUBLER, {
      name: 'wrong',
      input: { n: 3 },
      expect: { output: 7 },
    });
    expect(result.pass).toBe(false);
    expect(result.message).toBe('output mismatch — expected 7 but got 6');
    expect(result.failures).toEqual([
      {
        kind: 'output',
        mode: 'exact',
        mismatches: [
          {
            pointer: '',
            path: [],
            kind: 'changed',
            before: 7,
            after: 6,
            beforeKind: 'number',
            afterKind: 'number',
          },
        ],
        total: 1,
      },
    ]);
  });

  it('keeps the whole message of a mismatch, however large, as it always has', async () => {
    const said = 'x'.repeat(5000);
    const echo: Automation = {
      version: 1,
      name: 'echo',
      nodes: [
        {
          id: 'say',
          type: 'transform',
          input: { text: '{{ input.text }}' },
          code: 'return input.text;',
        },
      ],
      output: '{{ nodes.say.output }}',
    };
    const result = await judge(echo, {
      name: 'long',
      input: { text: said },
      expect: { output: 'short' },
    });
    expect(result.message).toBe(
      `output mismatch — expected "short" but got ${JSON.stringify(said)}`,
    );
  });

  it('reports missing effects naming the actual ones', async () => {
    const result = await judge(DOUBLER, {
      name: 'no such effect',
      input: { n: 1 },
      expect: { effects: [{ connector: 'mail.send' }] },
    });
    expect(result.message).toBe(
      'expected effect mail.send did not occur (actual: ping.send)',
    );
    expect(result.failures).toEqual([
      {
        kind: 'effect_missing',
        entry: 0,
        connector: 'mail.send',
        actual: [{ node: 'notify', connector: 'ping.send' }],
      },
    ]);
  });

  it('guides when the automation ships no tests', async () => {
    const answer = await runAutomationTests({ ...DOUBLER, tests: [] });
    expect(answer).toMatchObject({
      error: 'the automation has no tests',
      hint: expect.stringContaining('tests:'),
    });
  });

  it('surfaces run failures as test failures', async () => {
    // input.n missing → the code returns NaN, which JSON reads as null →
    // the transform returned nothing.
    const result = await judge(DOUBLER, {
      name: 'boom',
      input: {},
      expect: { output: 1 },
    });
    expect(result.pass).toBe(false);
    expect(result.message).toMatch(/^run error: /);
    expect(result.failures).toEqual([
      {
        kind: 'run_failed',
        node: 'double',
        message: expect.any(String),
        failure: {
          code: 'node_error',
          reason: expect.any(String),
          params: expect.any(Object),
        },
      },
    ]);
  });
});

describe('a test that cannot run fails; it is never skipped [AUTO-R43]', () => {
  it('a stand-in for a node the automation does not have refuses the test', async () => {
    const answer = report(
      await runAutomationTests({
        ...DOUBLER,
        tests: [
          { name: 'renamed', input: { n: 1 }, mocks: { doubel: 4 } },
          { name: 'still fine', input: { n: 1 }, expect: { output: 2 } },
        ],
      }),
    );
    expect(answer).toMatchObject({ passed: 1, failed: 1 });
    expect(answer.results[0]).toMatchObject({
      name: 'renamed',
      pass: false,
      message:
        'the test could not run: the test simulates "doubel", which is not a node of this automation',
      failures: [
        {
          kind: 'refused',
          issues: [
            {
              code: 'BENCH_UNKNOWN_NODE',
              at: { pointer: '/tests/0/mocks/doubel', subject: 'key' },
              params: { field: 'mocks', node: 'doubel', suggestion: 'double' },
            },
          ],
        },
      ],
    });
  });

  it('an input the inputs schema refuses refuses the test, in the run’s own words', async () => {
    const result = await judge(
      {
        ...DOUBLER,
        inputs: {
          type: 'object',
          properties: { n: { type: 'number' } },
          required: ['n'],
        },
      },
      { name: 'no n', input: {}, expect: { output: 0 } },
    );
    expect(result.pass).toBe(false);
    expect(result.message).toBe(
      'run error: run input does not match the automation "inputs" schema: input must have required property \'n\'',
    );
    expect(result.failures).toEqual([
      {
        kind: 'refused',
        issues: [
          expect.objectContaining({
            code: 'TESTS_INPUT_INVALID',
            at: { pointer: '/tests/0/input' },
            params: expect.objectContaining({ missing: ['n'] }),
          }),
        ],
      },
    ]);
  });

  it('a test the suite’s time does not reach is not run, and counts as failed', async () => {
    const answer = report(
      await runAutomationTests(DOUBLER, { suiteDeadlineMs: 0 }),
    );
    expect(answer).toEqual({
      passed: 0,
      failed: 2,
      results: [],
      notRun: ['doubles 3', 'pings'],
    });
  });
});

describe('judging a run', () => {
  const STEPS: Automation = {
    version: 1,
    name: 'steps',
    nodes: [
      {
        id: 'fetch',
        type: 'transform',
        input: { n: '{{ input.n }}' },
        code: 'return { rows: [input.n, input.n + 1], note: "x".repeat(300) };',
      },
      {
        id: 'notify',
        type: 'ping.send',
        when: '{{ nodes.fetch.output.rows.length > 1 }}',
        input: { first: '{{ nodes.fetch.output.rows[0] }}' },
        onError: 'continue',
      },
      {
        id: 'quiet',
        type: 'transform',
        elseOf: 'notify',
        code: 'return "quiet";',
      },
    ],
    output: {
      rows: '{{ nodes.fetch.output.rows }}',
      note: '{{ nodes.fetch.output.note }}',
      pinged: '{{ nodes.notify.output?.ok ?? false }}',
    },
  };

  it('keeps every miss of a run that ended as expected', async () => {
    const result = await judge(STEPS, {
      name: 'several',
      input: { n: 1 },
      expect: {
        output: { rows: [1, 9, 3], note: 'y', pinged: true },
        outputIncludes: { rows: [1, 2], pinged: false },
        effects: [
          { connector: 'ping.send', input: { first: 2 } },
          { connector: 'ping.send', absent: true },
        ],
        nodes: { quiet: 'ran', notify: 'ran' },
      },
    });
    expect(result.pass).toBe(false);
    expect(result.failures?.map((f) => f.kind)).toEqual([
      'output',
      'output',
      'effect_missing',
      'effect_present',
      'node_state',
    ]);
    const [exact, includes, missing, present, state] = result.failures ?? [];
    expect(exact).toMatchObject({ kind: 'output', mode: 'exact', total: 3 });
    // The 300-character text is quoted to 200.
    expect(exact).toMatchObject({
      mismatches: expect.arrayContaining([
        expect.objectContaining({
          pointer: '/note',
          before: 'y',
          after: `${'x'.repeat(200)}…`,
        }),
      ]),
    });
    expect(includes).toMatchObject({
      kind: 'output',
      mode: 'includes',
      total: 1,
      mismatches: [{ pointer: '/pinged', kind: 'changed' }],
    });
    expect(missing).toEqual({
      kind: 'effect_missing',
      entry: 0,
      connector: 'ping.send',
      closest: {
        node: 'notify',
        mismatches: [
          {
            pointer: '/first',
            path: ['first'],
            kind: 'changed',
            before: 2,
            after: 1,
            beforeKind: 'number',
            afterKind: 'number',
          },
        ],
        total: 1,
      },
      actual: [{ node: 'notify', connector: 'ping.send' }],
    });
    expect(present).toEqual({
      kind: 'effect_present',
      entry: 1,
      connector: 'ping.send',
      node: 'notify',
    });
    expect(state).toEqual({
      kind: 'node_state',
      node: 'quiet',
      expected: 'ran',
      actual: 'skipped',
    });
    // The first miss words the message, as this runner always has.
    expect(result.message).toBe(
      `output mismatch — expected {"rows":[1,9,3],"note":"y","pinged":true} but got {"rows":[1,2],"note":"${'x'.repeat(300)}","pinged":true}`,
    );
  });

  it('a failure the test simulates is judged like any other', async () => {
    const result = await judge(STEPS, {
      name: 'the ping fails and the run goes on',
      input: { n: 1 },
      failures: { notify: 'the service is down' },
      expect: {
        outputIncludes: { pinged: false },
        nodes: { notify: 'failed', quiet: 'skipped' },
        effects: [{ connector: 'ping.send', absent: true }],
      },
    });
    expect(result).toMatchObject({ pass: true });
    expect(result.failures).toBeUndefined();
    // The tolerated failure is the way the run went.
    expect(result.path).toEqual({
      id: 'when:notify=1|fail:notify=1',
      assignment: { 'when:notify': true, 'fail:notify': true },
    });
  });

  it('a run must fail where and how the test expects', async () => {
    const failing: Automation = {
      ...STEPS,
      nodes: STEPS.nodes.map((n) =>
        n.id === 'notify' ? { ...n, onError: 'fail' as const } : n,
      ),
    };
    const failure = (message: string, node?: string) => ({
      name: 'fails',
      input: { n: 1 },
      failures: { notify: 'The Service Is Down' },
      expect: { failure: { ...(node !== undefined && { node }), message } },
    });
    expect(
      await judge(failing, failure('service is down', 'notify')),
    ).toMatchObject({
      pass: true,
    });
    expect(await judge(failing, failure('timeout', 'notify'))).toMatchObject({
      pass: false,
      message:
        'the run failed at "notify" with "The Service Is Down (simulated by the test)", which does not contain "timeout"',
      failures: [
        {
          kind: 'failure_message',
          expected: 'timeout',
          actual: 'The Service Is Down (simulated by the test)',
          node: 'notify',
        },
      ],
    });
    expect(await judge(failing, failure('down', 'fetch'))).toMatchObject({
      pass: false,
      message:
        'expected the run to fail at "fetch", but it failed at "notify": The Service Is Down (simulated by the test)',
      failures: [
        {
          kind: 'failed_elsewhere',
          expectedNode: 'fetch',
          actualNode: 'notify',
        },
      ],
    });
    expect(
      await judge(STEPS, {
        name: 'expected to fail',
        input: { n: 1 },
        expect: { failure: { node: 'notify' } },
      }),
    ).toMatchObject({
      pass: false,
      message: 'expected the run to fail at "notify", but it succeeded',
      failures: [{ kind: 'run_succeeded', expected: { node: 'notify' } }],
    });
  });

  it('a run that fails unexpectedly says where and why, and nothing else', async () => {
    const result = await judge(STEPS, {
      name: 'unexpected',
      input: { n: 1 },
      failures: { fetch: 'no rows today' },
      expect: { output: { rows: [] }, nodes: { quiet: 'ran' } },
    });
    expect(result).toMatchObject({
      pass: false,
      message: 'run error: no rows today (simulated by the test)',
      failures: [
        {
          kind: 'run_failed',
          node: 'fetch',
          message: 'no rows today (simulated by the test)',
          failure: {
            code: 'node_error',
            reason: 'SIMULATED_FAILURE',
            params: { message: 'no rows today' },
          },
        },
      ],
    });
    expect(result.failures).toHaveLength(1);
    expect(result.path).toBeUndefined();
  });

  it('a test that runs past its time limit fails [AUTO-R43]', async () => {
    const answer = report(
      await runAutomationTests(
        { ...STEPS, tests: [{ name: 'slow', input: { n: 1 } }] },
        { testDeadlineMs: 0 },
      ),
    );
    expect(answer.results[0]).toMatchObject({
      pass: false,
      message: 'the test took longer than 0 s and was stopped',
      failures: [{ kind: 'timeout', limitMs: 0 }],
    });
  });

  it('names the stand-ins for nodes the run skipped', async () => {
    const result = await judge(STEPS, {
      name: 'short list',
      input: { n: 1 },
      mocks: { fetch: { rows: [5], note: '' }, notify: { ok: true } },
      expect: { nodes: { notify: 'skipped', quiet: 'ran' } },
    });
    expect(result).toMatchObject({
      pass: true,
      unusedMocks: ['notify'],
      path: { id: 'when:notify=0', assignment: { 'when:notify': false } },
    });
  });
});

describe('running some tests, stopping a suite, keeping what ran', () => {
  const THREE: Automation = {
    ...DOUBLER,
    tests: [
      { name: 'one', input: { n: 1 }, expect: { output: 2 } },
      { name: 'two', input: { n: 2 }, expect: { output: 5 } },
      { name: 'three', input: { n: 3 }, expect: { output: 6 } },
    ],
  };

  it('runs the selected tests only, and counts only them', async () => {
    const answer = report(
      await runAutomationTests(THREE, { select: [2, 1, 2, 7] }),
    );
    expect(answer.passed).toBe(1);
    expect(answer.failed).toBe(1);
    expect(answer.results.map((r) => [r.index, r.name, r.pass])).toEqual([
      [1, 'two', false],
      [2, 'three', true],
    ]);
  });

  it('a suite its caller stops names what it did not finish', async () => {
    // The stop lands while the second test runs, before its last step.
    const pinging: Automation = {
      version: 1,
      name: 'pinging',
      nodes: [
        { id: 'ping', type: 'ping.send', input: {} },
        { id: 'after', type: 'transform', code: 'return 1;' },
      ],
      output: '{{ nodes.after.output }}',
      tests: [
        { name: 'one', input: {} },
        { name: 'two', input: {} },
        { name: 'three', input: {} },
      ],
    };
    const stop = new AbortController();
    let pings = 0;
    onPing = () => {
      pings += 1;
      if (pings === 2) stop.abort();
    };
    try {
      const answer: TestReport = report(
        await runAutomationTests(pinging, { signal: stop.signal }),
      );
      expect(answer).toMatchObject({
        passed: 1,
        failed: 2,
        notRun: ['two', 'three'],
      });
      expect(answer.results.map((r) => r.name)).toEqual(['one']);
    } finally {
      onPing = undefined;
    }
  });

  it('keeps what each run produced, with its record, when asked', async () => {
    const answer = report(
      await runAutomationTests(
        { ...THREE, tests: THREE.tests?.slice(0, 1) },
        { detail: true, version: 4 },
      ),
    );
    const run = answer.results[0]?.run;
    expect(run).toMatchObject({
      status: 'success',
      output: 2,
      effects: [{ node: 'notify', connector: 'ping.send' }],
    });
    expect(run?.record?.view).toMatchObject({
      runId: 'test-0',
      source: 'transient',
      status: 'success',
      version: 4,
      mode: 'mock',
    });
    expect(run?.record?.view.nodes.map((n) => [n.path, n.status])).toEqual([
      ['__start', 'succeeded'],
      ['double', 'succeeded'],
      ['notify', 'succeeded'],
      ['__end', 'succeeded'],
    ]);
    expect(run?.record?.details.map((d) => d.path)).toEqual([
      '__start',
      'double',
      'notify',
      '__end',
    ]);
    // Without detail, a result carries no run.
    const plain = report(await runAutomationTests(THREE, { select: [0] }));
    expect(plain.results[0]?.run).toBeUndefined();
  });
});
