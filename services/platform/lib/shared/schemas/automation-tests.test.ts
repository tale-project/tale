// @vitest-environment node

/**
 * The tests wire schemas against what the engine produces: the grammar
 * accepts exactly the tests the engine's document check accepts; a report,
 * a stored report and a run made in one call parse as the engine writes
 * them, every kind of failure included; and the parsed shapes are the
 * engine's own types.
 */

import type { DiffKind } from '@tale/ui/data/value-diff';
import type { ValueKind } from '@tale/ui/data/value-summary';
import { beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { dispatch, type DispatchStore } from '../../engine/api/dispatch';
import {
  runAutomationTests,
  type TestFailure,
  type TestReport,
} from '../../engine/api/tests';
import { execute } from '../../engine/core/execute';
import { benchFromTest } from '../../engine/core/execute/bench';
import { createRecorder } from '../../engine/core/record/recorder';
import { transientRecord } from '../../engine/core/record/transient';
import { recordBudget } from '../../engine/core/record/value';
import { registerNodeType, setCodeRunner } from '../../engine/core/slots';
import type {
  Automation,
  AutomationTest,
  BenchMark,
  RunBench,
  RunResult,
} from '../../engine/core/types';
import { validate } from '../../engine/core/validate';
import { nodeVmRunner } from '../../engine/runners/node-vm';
import { memoryStore } from '../../engine/selftest/memory-store';
import {
  automationTestSchema,
  BENCH_LIMITS,
  diffChangeSchema,
  runBenchSchema,
  STORED_TEST_REPORT_MAX_BYTES,
  storedTestReport,
  storedTestReportSchema,
  testFailureSchema,
  testReportSchema,
  transientRunSchema,
} from './automation-tests';

/** Whether two types are the same type. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/** A value as it travels: JSON, nothing `undefined` left in it. */
function wire<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** The agent tools over the versioned in-memory store: saves and reads. */
function dispatchStore(): DispatchStore {
  const memory = memoryStore();
  return {
    list: () => memory.list(),
    get: (name, version) => memory.get(name, version),
    deployedVersion: (name) => memory.deployedVersion(name),
    async save(automation: Automation, message?: string) {
      const { version } = memory.save(automation.name, automation, message);
      return { name: automation.name, version };
    },
    async deploy(name: string, version: number) {
      memory.deploy(name, version);
      return { name, version };
    },
  };
}

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
  registerNodeType({
    type: 'probe.send',
    kind: 'connector',
    outputKind: 'structured',
    description: 'test connector: sends a probe',
    allowedFields: ['input'],
    requiredFields: ['input'],
    connector: {
      name: 'probe.send',
      description: 'send a probe',
      inputSchema: { type: 'object' },
      outputSignature: '{ ok: boolean }',
      hasEffect: true,
      mock: () => ({ ok: true }),
    },
  });
});

/** A document whose tests end in every kind of failure there is. */
const PROBE: Automation = {
  version: 1,
  name: 'schema-probe',
  inputs: {
    type: 'object',
    properties: { n: { type: 'number' } },
    required: ['n'],
  },
  nodes: [
    {
      id: 'double',
      type: 'transform',
      input: { n: '{{ input.n }}' },
      code: 'if (input.n < 0) throw new Error("negative input"); return { n: input.n * 2, list: [1, 2, 3, 4, 5, 6, 7] };',
    },
    {
      id: 'notify',
      type: 'probe.send',
      input: { note: 'done', n: '{{ nodes.double.output.n }}' },
    },
  ],
  output: '{{ nodes.double.output }}',
  tests: [
    { name: 'passes', input: { n: 1 }, expect: { outputIncludes: { n: 2 } } },
    { name: 'stands in for a stranger', input: { n: 1 }, mocks: { nope: {} } },
    { name: 'misses its input', input: {} },
    { name: 'fails to run', input: { n: -1 } },
    {
      name: 'should fail',
      input: { n: 1 },
      expect: { failure: { node: 'double' } },
    },
    {
      name: 'fails elsewhere',
      input: { n: -1 },
      expect: { failure: { node: 'notify' } },
    },
    {
      name: 'fails otherwise',
      input: { n: -1 },
      expect: { failure: { node: 'double', message: 'positive' } },
    },
    {
      name: 'differs eight times',
      input: { n: 1 },
      expect: { output: { n: 3, list: [0, 0, 0, 0, 0, 0, 0] } },
    },
    {
      name: 'misses an effect',
      input: { n: 1 },
      expect: {
        effects: [{ connector: 'probe.send', input: { note: 'other', n: 2 } }],
      },
    },
    {
      name: 'has an unwanted effect',
      input: { n: 1 },
      expect: { effects: [{ connector: 'probe.send', absent: true }] },
    },
    {
      name: 'expects a skip',
      input: { n: 1 },
      expect: { nodes: { notify: 'skipped' } },
    },
  ],
};

async function reportOf(
  automation: Automation,
  options: Parameters<typeof runAutomationTests>[1] = {},
): Promise<TestReport> {
  const answer = await runAutomationTests(automation, options);
  if (!('results' in answer)) throw new Error(answer.error);
  return answer;
}

function failureKinds(report: TestReport): Set<TestFailure['kind']> {
  return new Set(
    report.results.flatMap((result) =>
      (result.failures ?? []).map((failure) => failure.kind),
    ),
  );
}

describe('the test grammar', () => {
  /** Whether the engine's document check accepts the shape of `test`. */
  async function engineAccepts(test: unknown): Promise<boolean> {
    const { errors } = await validate({
      version: 1,
      name: 'grammar',
      nodes: [{ id: 'a', type: 'transform', code: 'return 1;' }],
      output: '{{ nodes.a.output }}',
      tests: [test],
    });
    return !errors.some((issue) => issue.code === 'TESTS_INVALID');
  }

  const long = (n: number) => 'x'.repeat(n);
  const cases: Array<[string, unknown]> = [
    ['the least a test is', { name: 'minimal', input: {} }],
    ['a null input', { name: 'null input', input: null }],
    ['an empty name', { name: '', input: 1 }],
    ['a description', { name: 'd', description: 'why', input: {} }],
    [
      'stand-ins',
      { name: 's', input: {}, mocks: { a: { x: 1 } }, failures: { a: 'boom' } },
    ],
    [
      'the longest simulated failure',
      {
        name: 'f',
        input: {},
        failures: { a: long(BENCH_LIMITS.failureChars) },
      },
    ],
    [
      'one simulated failure too long',
      {
        name: 'f',
        input: {},
        failures: { a: long(BENCH_LIMITS.failureChars + 1) },
      },
    ],
    [
      'every expectation',
      {
        name: 'e',
        input: {},
        expect: {
          output: 1,
          effects: [
            { connector: 'llm' },
            { connector: 'x', node: 'a', input: { a: 1 } },
            { connector: 'x', inputIncludes: { a: 1 } },
            { connector: 'x', absent: true },
          ],
          nodes: { a: 'ran', b: 'skipped', c: 'failed' },
        },
      },
    ],
    ['an inclusion', { name: 'i', input: {}, expect: { outputIncludes: {} } }],
    [
      'an expected failure',
      {
        name: 'f',
        input: {},
        expect: { failure: { node: 'a', message: 'm' } },
      },
    ],
    [
      'an empty expected failure',
      { name: 'f', input: {}, expect: { failure: {} } },
    ],
    [
      'a member the grammar does not know',
      { name: 'u', input: {}, extra: true },
    ],
    [
      'an effect member the grammar does not know',
      {
        name: 'u',
        input: {},
        expect: { effects: [{ connector: 'x', extra: 1 }] },
      },
    ],
    ['no name', { input: {} }],
    ['a name that is no text', { name: 1, input: {} }],
    ['no input', { name: 'n' }],
    ['a test that is no object', 'test'],
    ['a description that is no text', { name: 'd', input: {}, description: 3 }],
    ['a null description', { name: 'd', input: {}, description: null }],
    ['stand-ins in a list', { name: 'm', input: {}, mocks: [] }],
    ['null stand-ins', { name: 'm', input: {}, mocks: null }],
    ['a failure that is no text', { name: 'f', input: {}, failures: { a: 1 } }],
    [
      'an expectation member unknown',
      { name: 'e', input: {}, expect: { outputs: 1 } },
    ],
    ['an expectation that is a list', { name: 'e', input: {}, expect: [] }],
    ['a null expectation', { name: 'e', input: {}, expect: null }],
    [
      'effects that are no list',
      { name: 'e', input: {}, expect: { effects: {} } },
    ],
    [
      'an effect without its connector',
      { name: 'e', input: {}, expect: { effects: [{ node: 'a' }] } },
    ],
    [
      'an effect node that is no text',
      {
        name: 'e',
        input: {},
        expect: { effects: [{ connector: 'x', node: 1 }] },
      },
    ],
    [
      'an effect input given twice',
      {
        name: 'e',
        input: {},
        expect: {
          effects: [{ connector: 'x', input: null, inputIncludes: 1 }],
        },
      },
    ],
    [
      'absent false',
      {
        name: 'e',
        input: {},
        expect: { effects: [{ connector: 'x', absent: false }] },
      },
    ],
    [
      'a node state unknown',
      { name: 'e', input: {}, expect: { nodes: { a: 'maybe' } } },
    ],
    ['node states in a list', { name: 'e', input: {}, expect: { nodes: [] } }],
    [
      'an expected failure member unknown',
      { name: 'e', input: {}, expect: { failure: { node: 'a', at: 1 } } },
    ],
    [
      'an expected failure node that is no text',
      { name: 'e', input: {}, expect: { failure: { node: 1 } } },
    ],
    [
      'an expected failure message that is null',
      { name: 'e', input: {}, expect: { failure: { message: null } } },
    ],
    [
      'an expected failure beside an output',
      { name: 'e', input: {}, expect: { failure: {}, output: null } },
    ],
    [
      'an expected failure beside an inclusion',
      { name: 'e', input: {}, expect: { failure: {}, outputIncludes: 1 } },
    ],
  ];

  it.each(cases)('reads %s as the engine check does', async (_label, test) => {
    expect(automationTestSchema.safeParse(test).success).toBe(
      await engineAccepts(test),
    );
  });

  it('keeps the members a test does not define, and reads as the engine type', () => {
    const parsed: AutomationTest = automationTestSchema.parse({
      name: 'kept',
      input: { n: 1 },
      future: { anything: true },
    });
    expect(parsed).toEqual({
      name: 'kept',
      input: { n: 1 },
      future: { anything: true },
    });
  });

  it('takes the bench a test runs with, and a step test scope', () => {
    const test = PROBE.tests?.[1];
    if (test === undefined) throw new Error('no test');
    const bench: RunBench = runBenchSchema.parse(wire(benchFromTest(test, 1)));
    expect(bench).toEqual({
      mocks: { nope: {} },
      test: { name: 'stands in for a stranger', index: 1 },
    });
    for (const scope of [
      { upTo: 'notify' },
      { only: 'notify', item: 0, mocks: { double: { n: 2 } } },
      { failures: { notify: long(BENCH_LIMITS.failureChars) } },
    ]) {
      expect(runBenchSchema.safeParse(scope).success).toBe(true);
    }
    for (const refused of [
      { upTo: 'notify', extra: 1 },
      { only: 'notify', item: -1 },
      { item: 1.5 },
      { failures: { notify: long(BENCH_LIMITS.failureChars + 1) } },
      { test: { name: 'x', extra: 1 } },
      { only: long(51) },
    ]) {
      expect(runBenchSchema.safeParse(refused).success).toBe(false);
    }
  });
});

describe('a test report', () => {
  it('names the engine kinds and marks exactly', () => {
    const failures: Equal<
      z.infer<typeof testFailureSchema>['kind'],
      TestFailure['kind']
    > = true;
    const marks: Equal<
      NonNullable<z.infer<typeof transientRunSchema>['trace'][number]['bench']>,
      BenchMark
    > = true;
    const diffKinds: Equal<z.infer<typeof diffChangeSchema>['kind'], DiffKind> =
      true;
    const valueKinds: Equal<
      NonNullable<z.infer<typeof diffChangeSchema>['beforeKind']>,
      ValueKind
    > = true;
    expect([failures, marks, diffKinds, valueKinds]).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it('parses what the runner answers, every kind of failure and each run included', async () => {
    const report = await reportOf(PROBE, { detail: true, version: 3 });
    const timedOut = await reportOf(
      { ...PROBE, tests: PROBE.tests?.slice(0, 1) },
      { testDeadlineMs: 0 },
    );
    const all = [...failureKinds(report), ...failureKinds(timedOut)];
    expect(new Set(all)).toEqual(
      new Set([
        'refused',
        'run_failed',
        'run_succeeded',
        'failed_elsewhere',
        'failure_message',
        'output',
        'effect_missing',
        'effect_present',
        'node_state',
        'timeout',
      ]),
    );
    for (const answer of [report, timedOut]) {
      const parsed: TestReport = testReportSchema.parse(wire(answer));
      expect(parsed).toEqual(wire(answer));
    }
    // Each test that ran kept its run and its record; a refused one has
    // neither.
    const ran = report.results.filter((result) => result.run !== undefined);
    expect(ran.length).toBeGreaterThan(5);
    expect(ran.every((result) => result.run?.record !== undefined)).toBe(true);
  });

  it('lists five differences of an output and counts them all', async () => {
    const report = await reportOf(PROBE);
    const output = report.results
      .flatMap((result) => result.failures ?? [])
      .find((failure) => failure.kind === 'output');
    expect(output).toMatchObject({ mode: 'exact', total: 8 });
    expect(output?.kind === 'output' && output.mismatches).toHaveLength(5);
    const sixth = wire({
      kind: 'output',
      mode: 'exact',
      total: 6,
      mismatches: Array.from({ length: 6 }, (_, i) => ({
        pointer: `/${i}`,
        path: [i],
        kind: 'changed',
        before: 0,
        after: 1,
      })),
    });
    expect(testFailureSchema.safeParse(sixth).success).toBe(false);
  });

  it('parses the tests the suite did not reach', async () => {
    const report = await reportOf(PROBE, { suiteDeadlineMs: 0 });
    expect(report.notRun).toHaveLength(PROBE.tests?.length ?? 0);
    expect(testReportSchema.parse(wire(report))).toEqual(wire(report));
  });

  it('parses the answer the agent tool gives, for a draft and a saved version', async () => {
    const store = dispatchStore();
    const draft = await dispatch(
      'test_automation',
      { automation: PROBE },
      { store },
    );
    expect(testReportSchema.safeParse(wire(draft)).success).toBe(true);
    await dispatch('save_automation', { automation: PROBE }, { store });
    const saved = await dispatch(
      'test_automation',
      { name: PROBE.name },
      { store },
    );
    expect(saved).toMatchObject({ name: PROBE.name, version: 1 });
    expect(testReportSchema.safeParse(wire(saved)).success).toBe(true);
  });
});

describe('a run made in one call', () => {
  async function tried(bench: RunBench): Promise<unknown> {
    const startedAt = Date.now();
    const result = await execute(PROBE, {
      input: { n: 1 },
      mode: 'mock',
      bench,
      recorder: createRecorder({
        now: () => Date.now(),
        budget: recordBudget(),
      }),
    });
    const record = transientRecord({
      doc: PROBE,
      result,
      id: 'try-1',
      version: 2,
      startedAt,
      finishedAt: Date.now(),
    });
    const { record: _rows, ...rest } = result;
    return wire({
      ...rest,
      ms: 4,
      documentHash: 'h1',
      version: 2,
      bench,
      ...(record !== undefined && { record }),
    });
  }

  it('parses a step test on pinned data, its marks and its scope included', async () => {
    const answer = await tried({
      only: 'notify',
      mocks: { double: { n: 2, list: [] } },
    });
    const parsed: Omit<RunResult, 'record'> = transientRunSchema.parse(answer);
    expect(parsed.focus).toEqual({ node: 'notify', kind: 'only' });
    expect(parsed.trace.map((entry) => entry.bench)).toEqual([
      'pinned',
      undefined,
    ]);
    expect(transientRunSchema.parse(answer)).toEqual(answer);
  });

  it('parses a run up to a node, with what it left out', async () => {
    const answer = await tried({ upTo: 'double', mocks: { notify: {} } });
    const parsed = transientRunSchema.parse(answer);
    expect(parsed.unusedMocks).toEqual(['notify']);
    expect(parsed.trace.find((entry) => entry.node === 'notify')?.bench).toBe(
      'left-out',
    );
  });

  it('parses a bench the run refused, with its issue', async () => {
    const answer = await tried({ mocks: { nope: {} } });
    const parsed = transientRunSchema.parse(answer);
    expect(parsed.status).toBe('invalid');
    expect(parsed.validation?.errors[0]?.code).toBe('BENCH_UNKNOWN_NODE');
  });
});

describe('the stored report', () => {
  it('keeps each result without its run, and its path by id', async () => {
    const report = await reportOf(PROBE, { detail: true });
    const stored = storedTestReport(report, 1_700_000_000_000);
    expect(storedTestReportSchema.parse(wire(stored))).toEqual(wire(stored));
    expect('trimmed' in stored).toBe(false);
    expect(stored).toMatchObject({
      checkedAt: 1_700_000_000_000,
      passed: report.passed,
      failed: report.failed,
    });
    for (const [i, result] of stored.results.entries()) {
      const source = report.results[i];
      expect(result).not.toHaveProperty('run');
      expect(result).not.toHaveProperty('message');
      expect(result).not.toHaveProperty('unusedMocks');
      expect(result.path).toBe(source?.path?.id);
      expect(result.failures ?? []).toEqual(wire(source?.failures ?? []));
    }
  });

  /** A report of fifty failed tests, each with a long sentence. */
  function heavy(name: (i: number) => string): TestReport {
    return {
      passed: 0,
      failed: 50,
      results: Array.from({ length: 50 }, (_, index) => ({
        name: name(index),
        index,
        pass: false,
        ms: 1,
        message: 'boom',
        failures: [{ kind: 'run_failed' as const, message: 'x'.repeat(4096) }],
      })),
    };
  }

  function bytes(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  }

  it('keeps the kind of each failure alone past its size', () => {
    const stored = storedTestReport(
      heavy((i) => `test ${i}`),
      1,
    );
    expect(stored).toMatchObject({ trimmed: true });
    expect(stored.results[0]?.failures).toEqual([{ kind: 'run_failed' }]);
    expect(stored.results[0]?.name).toBe('test 0');
    expect(bytes(stored)).toBeLessThanOrEqual(STORED_TEST_REPORT_MAX_BYTES);
    expect(storedTestReportSchema.safeParse(wire(stored)).success).toBe(true);
  });

  it('cuts the names too when the kinds alone do not fit', () => {
    const stored = storedTestReport(
      {
        ...heavy((i) => `${i} ${'n'.repeat(5000)}`),
        notRun: ['m'.repeat(5000)],
      },
      1,
    );
    expect(stored).toMatchObject({ trimmed: true });
    expect(stored.results[0]?.name).toHaveLength(201);
    expect(stored.results[0]?.name.endsWith('…')).toBe(true);
    expect(stored.notRun?.[0]).toHaveLength(201);
    expect(bytes(stored)).toBeLessThanOrEqual(STORED_TEST_REPORT_MAX_BYTES);
  });

  it('keeps a failure it cannot read by its kind, in a trimmed report', () => {
    const report: TestReport = {
      passed: 0,
      failed: 1,
      results: [
        {
          name: 'odd',
          index: 0,
          pass: false,
          ms: 1,
          failures: [{ kind: 'timeout', limitMs: -1 }],
        },
      ],
    };
    const stored = storedTestReport(report, 1);
    expect(stored).toEqual({
      checkedAt: 1,
      passed: 0,
      failed: 1,
      trimmed: true,
      results: [
        {
          name: 'odd',
          index: 0,
          pass: false,
          ms: 1,
          failures: [{ kind: 'timeout' }],
        },
      ],
    });
  });

  it('refuses a failure kept by its kind in a report that says it kept them whole', () => {
    const report = {
      checkedAt: 1,
      passed: 0,
      failed: 1,
      results: [
        {
          name: 'x',
          index: 0,
          pass: false,
          ms: 1,
          failures: [{ kind: 'timeout' }],
        },
      ],
    };
    expect(storedTestReportSchema.safeParse(report).success).toBe(false);
    expect(
      storedTestReportSchema.safeParse({ ...report, trimmed: true }).success,
    ).toBe(true);
  });
});
