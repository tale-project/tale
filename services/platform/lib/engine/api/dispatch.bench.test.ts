import { beforeEach, describe, expect, it, vi } from 'vitest';

import { execute } from '../core/execute';
import {
  DISPATCH_REFUSAL_CODES,
  dispatch,
  type DispatchStore,
} from './dispatch';
import { DOC_EXAMPLE } from './docs';
import { runAutomationTests, type TestReport } from './tests';

vi.mock('./tests', () => ({ runAutomationTests: vi.fn() }));
vi.mock('../core/execute', () => ({ execute: vi.fn() }));

/**
 * What an agent runs through the engine without saving anything: some of an
 * automation's tests, or all, and the automation itself on stand-ins it
 * names or one step on data it pins. The runs happen in the API process, so
 * a host that charges them (`admitBench`) is asked first and told when each
 * run is over. The runner and the executor are doubles; what they do with a
 * bench is the engine's own tests'.
 */

const NAME = 'billing/dunning';
const test = (name: string) => ({
  name,
  input: { min_total: 100, orders: [] },
  expect: {
    output: {
      stats: { count: 0, sum: 0 },
      message: 'No qualifying orders.',
    },
  },
});
const DOC = {
  ...DOC_EXAMPLE.automation,
  name: NAME,
  tests: [test('happy'), test('sad'), test('tipsy')],
};

/** A store holding `billing/dunning` at v7. */
function store(overrides: Partial<DispatchStore> = {}): DispatchStore {
  return {
    list: async () => [{ name: NAME, latest: 7, deployedVersion: 5 }],
    get: async (name: string, version?: number) =>
      name === NAME && (version === undefined || version <= 7)
        ? { meta: { version: version ?? 7 }, automation: DOC }
        : null,
    deployedVersion: async () => 5,
    save: async () => ({ name: NAME, version: 8 }),
    deploy: async (name: string, version: number) => ({ name, version }),
    ...overrides,
  };
}

const passed = (...names: string[]): TestReport => ({
  passed: names.length,
  failed: 0,
  results: names.map((name, index) => ({ name, index, pass: true, ms: 1 })),
});

beforeEach(() => {
  vi.mocked(runAutomationTests).mockReset();
  vi.mocked(runAutomationTests).mockResolvedValue(
    passed('happy', 'sad', 'tipsy'),
  );
  vi.mocked(execute).mockReset();
  vi.mocked(execute).mockResolvedValue({
    status: 'success',
    output: 'ok',
    trace: [],
    effects: [],
  });
});

describe('test_automation picks tests by name', () => {
  it('runs the tests named, by their place, and records nothing for a part of the suite [MCP-R33]', async () => {
    const recordTestVerdict = vi.fn(async () => {});
    vi.mocked(runAutomationTests).mockResolvedValue(passed('happy', 'tipsy'));
    const result = await dispatch(
      'test_automation',
      { name: NAME, tests: ['tipsy', 'happy'] },
      { store: store({ recordTestVerdict }) },
    );
    expect(runAutomationTests).toHaveBeenCalledWith(
      DOC,
      expect.objectContaining({ select: [0, 2] }),
    );
    expect(recordTestVerdict).not.toHaveBeenCalled();
    expect(result).toMatchObject({ name: NAME, version: 7, passed: 2 });
    expect(result).not.toHaveProperty('recorded');
  });

  it('records the whole suite of a saved version as made by hand, and says so [MCP-R33]', async () => {
    const recordTestVerdict = vi.fn(async () => {});
    const result = await dispatch(
      'test_automation',
      { name: NAME, version: 6 },
      { store: store({ recordTestVerdict }) },
    );
    expect(recordTestVerdict).toHaveBeenCalledWith(NAME, 6, true, {
      via: 'manual',
      report: expect.objectContaining({ passed: 3 }),
    });
    expect(result).toMatchObject({
      recorded: { version: 6, testsPassed: true },
    });
    // The runner is asked for no selection: the whole suite.
    expect(vi.mocked(runAutomationTests).mock.calls[0]?.[1]).not.toHaveProperty(
      'select',
    );
  });

  it('records no verdict when the suite’s time ran out before its end, and names the tests it did not reach [MCP-R33]', async () => {
    const recordTestVerdict = vi.fn(async () => {});
    vi.mocked(runAutomationTests).mockResolvedValue({
      passed: 1,
      failed: 2,
      results: [{ name: 'happy', index: 0, pass: true, ms: 1 }],
      notRun: ['sad', 'tipsy'],
    });
    const result = await dispatch(
      'test_automation',
      { name: NAME },
      { store: store({ recordTestVerdict }) },
    );
    expect(recordTestVerdict).not.toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 2, notRun: ['sad', 'tipsy'] });
    expect(result).not.toHaveProperty('recorded');
  });

  it('does not claim a verdict recorded where the host keeps none', async () => {
    const result = await dispatch(
      'test_automation',
      { name: NAME },
      { store: store() },
    );
    expect(result).toMatchObject({ name: NAME, version: 7, passed: 3 });
    expect(result).not.toHaveProperty('recorded');
  });

  it('refuses a name that is not a test, naming the tests there are, and one more than one test bears, naming where', async () => {
    const unknown = await dispatch(
      'test_automation',
      { name: NAME, tests: ['nope'] },
      { store: store() },
    );
    expect(unknown).toMatchObject({
      code: 'INVALID_PARAMS',
      hint: expect.stringContaining('happy, sad, tipsy'),
    });
    // A near miss says which test it was probably meant for; a name far from
    // every test suggests nothing.
    const typo = await dispatch(
      'test_automation',
      { name: NAME, tests: ['hapy'] },
      { store: store() },
    );
    expect(typo).toMatchObject({
      hint: expect.stringContaining('did you mean "happy"?'),
    });
    expect(unknown).toMatchObject({
      hint: expect.not.stringContaining('did you mean'),
    });
    const twice = {
      ...DOC,
      tests: [test('same'), test('other'), test('same')],
    };
    const ambiguous = await dispatch(
      'test_automation',
      { name: NAME, tests: ['same'] },
      {
        store: store({
          get: async () => ({ meta: { version: 7 }, automation: twice }),
        }),
      },
    );
    expect(ambiguous).toMatchObject({
      code: 'INVALID_PARAMS',
      error: expect.stringContaining('"same"'),
      hint: expect.stringContaining('0 and 2'),
    });
    expect(runAutomationTests).not.toHaveBeenCalled();
  });

  it('refuses names for an automation that has no tests at all', async () => {
    const { tests: _tests, ...untested } = DOC;
    const result = await dispatch(
      'test_automation',
      { automation: untested, tests: ['happy'] },
      { store: store() },
    );
    expect(result).toMatchObject({
      code: 'INVALID_PARAMS',
      error: 'the automation has no tests',
    });
    expect(runAutomationTests).not.toHaveBeenCalled();
  });

  it('tests a draft the same way, picking by name', async () => {
    await dispatch(
      'test_automation',
      { automation: DOC, tests: ['sad'] },
      { store: store() },
    );
    expect(runAutomationTests).toHaveBeenCalledWith(
      DOC,
      expect.objectContaining({ select: [1] }),
    );
  });
});

describe('test_automation keeps what each run produced only as far as the call asks', () => {
  const run = {
    status: 'success' as const,
    output: { total: 12 },
    effects: [{ node: 'send', connector: 'slack', input: {} }],
    record: { id: 'try-1', nodes: [] } as never,
  };
  const detailed = (): TestReport => ({
    passed: 1,
    failed: 0,
    results: [{ name: 'happy', index: 0, pass: true, ms: 1, run }],
  });

  it('asks the runner for the runs only when the call names a detail', async () => {
    await dispatch('test_automation', { name: NAME }, { store: store() });
    expect(vi.mocked(runAutomationTests).mock.calls[0]?.[1]).not.toHaveProperty(
      'detail',
    );
    vi.mocked(runAutomationTests).mockClear();
    await dispatch(
      'test_automation',
      { name: NAME, detail: ['output'] },
      { store: store() },
    );
    expect(runAutomationTests).toHaveBeenCalledWith(
      DOC,
      expect.objectContaining({ detail: true }),
    );
  });

  it.each([
    [['output'], { status: 'success', output: { total: 12 } }],
    [['effects'], { status: 'success', effects: run.effects }],
    [['trace'], { status: 'success', record: run.record }],
    [
      ['trace', 'output', 'effects'],
      {
        status: 'success',
        output: { total: 12 },
        effects: run.effects,
        record: run.record,
      },
    ],
  ])('detail %j keeps %j', async (detail, kept) => {
    vi.mocked(runAutomationTests).mockResolvedValue(detailed());
    const result = (await dispatch(
      'test_automation',
      { name: NAME, detail },
      { store: store() },
    )) as TestReport;
    expect(result.results[0]?.run).toEqual(kept);
  });

  it('leaves out a run too large to carry, and says so', async () => {
    vi.mocked(runAutomationTests).mockResolvedValue({
      passed: 1,
      failed: 0,
      results: [
        {
          name: 'happy',
          index: 0,
          pass: true,
          ms: 1,
          run: { status: 'success', output: 'x'.repeat(300_000) },
        },
      ],
    });
    const result = (await dispatch(
      'test_automation',
      { name: NAME, detail: ['output'] },
      { store: store() },
    )) as TestReport;
    expect(result.results[0]).toMatchObject({ detailOmitted: true });
    expect(result.results[0]).not.toHaveProperty('run');
  });
});

describe('what a bench run draws from the organization', () => {
  it('asks for a place for as many runs as there are tests, and gives it back when they are done [MCP-R33]', async () => {
    const release = vi.fn();
    const admitBench = vi.fn(async () => release);
    await dispatch(
      'test_automation',
      { name: NAME, tests: ['happy', 'sad'] },
      { store: store({ admitBench }) },
    );
    expect(admitBench).toHaveBeenCalledWith(2);
    expect(release).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(runAutomationTests).mock.invocationCallOrder[0],
    ).toBeGreaterThan(admitBench.mock.invocationCallOrder[0] ?? 0);
  });

  it('gives the place back when the tests throw', async () => {
    const release = vi.fn();
    vi.mocked(runAutomationTests).mockRejectedValue(new Error('boom'));
    await expect(
      dispatch(
        'test_automation',
        { name: NAME },
        { store: store({ admitBench: async () => release }) },
      ),
    ).rejects.toThrow('boom');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('refuses the call with the wait when the budget is spent or every place is taken, running nothing [MCP-R33]', async () => {
    const result = await dispatch(
      'test_automation',
      { name: NAME },
      { store: store({ admitBench: async () => ({ retryAfterMs: 1500 }) }) },
    );
    expect(result).toMatchObject({
      code: 'RATE_LIMITED',
      data: { retryAfterMs: 1500 },
      hint: expect.stringContaining('1.5'),
    });
    expect(DISPATCH_REFUSAL_CODES).toContain('RATE_LIMITED');
    expect(runAutomationTests).not.toHaveBeenCalled();
  });

  it('charges a document with no tests nothing', async () => {
    const admitBench = vi.fn(async () => () => {});
    const { tests: _tests, ...untested } = DOC;
    await dispatch(
      'test_automation',
      { automation: untested },
      { store: store({ admitBench }) },
    );
    expect(admitBench).not.toHaveBeenCalled();
  });
});

describe('run_automation on stand-ins', () => {
  const bench = { mocks: { calc: { count: 2, sum: 290 } }, only: 'summary' };

  it('hands the bench to the run, within a time limit, and answers where it stood in [MCP-R34]', async () => {
    vi.mocked(execute).mockResolvedValue({
      status: 'success',
      output: { text: 'ok' },
      trace: [],
      effects: [],
      focus: { node: 'summary', kind: 'only' },
      unusedMocks: ['calc'],
    });
    const result = await dispatch(
      'run_automation',
      { automation: DOC, input: { n: 1 }, ...bench },
      { store: store() },
    );
    expect(execute).toHaveBeenCalledWith(
      DOC,
      expect.objectContaining({
        mode: 'mock',
        input: { n: 1 },
        bench,
        deadline: expect.any(Number),
      }),
    );
    expect(result).toMatchObject({
      status: 'success',
      output: { text: 'ok' },
      focus: { node: 'summary', kind: 'only' },
      unusedMocks: ['calc'],
    });
  });

  it('names the node a run goes up to, the failures it simulates and the item it picks', async () => {
    await dispatch(
      'run_automation',
      {
        automation: DOC,
        upTo: 'calc',
        failures: { summary: 'the model is down' },
        item: 0,
      },
      { store: store() },
    );
    expect(execute).toHaveBeenCalledWith(
      DOC,
      expect.objectContaining({
        bench: {
          upTo: 'calc',
          failures: { summary: 'the model is down' },
          item: 0,
        },
      }),
    );
  });

  it.each([
    ['mocks', 5],
    ['failures', { summary: 1 }],
    ['upTo', 3],
    ['only', ['calc']],
    ['item', -1],
    ['item', 1.5],
  ])('refuses %s of %j, naming it, running nothing', async (field, value) => {
    const result = await dispatch(
      'run_automation',
      { automation: DOC, [field]: value },
      { store: store() },
    );
    expect(result).toMatchObject({
      code: 'INVALID_PARAMS',
      error: expect.stringContaining(`params.${field}`),
      hint: expect.stringContaining('stand-ins'),
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a bench the document cannot take as the request’s fault, with the issue [MCP-R34]', async () => {
    vi.mocked(execute).mockResolvedValue({
      status: 'invalid',
      trace: [],
      effects: [],
      validation: {
        errors: [
          {
            level: 'error',
            code: 'BENCH_UNKNOWN_NODE',
            message: 'the document has no node "zzz"',
            hint: 'its nodes are calc, summary, summary_empty',
          },
        ],
        warnings: [],
      },
    });
    const result = await dispatch(
      'run_automation',
      { automation: DOC, mocks: { zzz: 1 } },
      { store: store() },
    );
    expect(result).toMatchObject({
      code: 'BENCH_INVALID',
      error: 'the document has no node "zzz"',
      hint: 'its nodes are calc, summary, summary_empty',
      data: { issue: { code: 'BENCH_UNKNOWN_NODE' } },
    });
    expect(DISPATCH_REFUSAL_CODES).toContain('BENCH_INVALID');
  });

  it('is not a refusal when the document itself is what the run found wrong', async () => {
    vi.mocked(execute).mockResolvedValue({
      status: 'invalid',
      trace: [],
      effects: [],
      validation: {
        errors: [
          { level: 'error', code: 'TESTS_INPUT_INVALID', message: 'bad input' },
        ],
        warnings: [],
      },
    });
    const result = await dispatch(
      'run_automation',
      { automation: DOC },
      { store: store() },
    );
    expect(result).toMatchObject({ status: 'invalid' });
    expect(result).not.toHaveProperty('code');
  });

  it('draws one place for a run on the mocks, bench or not, and gives it back [MCP-R34]', async () => {
    const release = vi.fn();
    const admitBench = vi.fn(async () => release);
    await dispatch(
      'run_automation',
      { automation: DOC, mocks: { calc: 1 } },
      { store: store({ admitBench }) },
    );
    await dispatch(
      'run_automation',
      { automation: DOC },
      { store: store({ admitBench }) },
    );
    expect(admitBench.mock.calls).toEqual([[1], [1]]);
    expect(release).toHaveBeenCalledTimes(2);
    // A plain run has no bench, but the same time limit.
    const options = vi.mocked(execute).mock.calls[1]?.[1];
    expect(options).not.toHaveProperty('bench');
    expect(options).toHaveProperty('deadline');
  });

  it('gives the place back when the run throws', async () => {
    const release = vi.fn();
    vi.mocked(execute).mockRejectedValue(new Error('boom'));
    await expect(
      dispatch(
        'run_automation',
        { automation: DOC },
        { store: store({ admitBench: async () => release }) },
      ),
    ).rejects.toThrow('boom');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('refuses a run with the wait when the budget is spent, running nothing', async () => {
    const result = await dispatch(
      'run_automation',
      { automation: DOC, only: 'calc' },
      { store: store({ admitBench: async () => ({ retryAfterMs: 2000 }) }) },
    );
    expect(result).toMatchObject({
      code: 'RATE_LIMITED',
      data: { retryAfterMs: 2000 },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('asks nothing of the meter for a document that fails its checks', async () => {
    const admitBench = vi.fn(async () => () => {});
    const result = await dispatch(
      'run_automation',
      { automation: { name: 'nope', nodes: 'not-a-list' } },
      { store: store({ admitBench }) },
    );
    expect(result).toMatchObject({ status: 'invalid' });
    expect(admitBench).not.toHaveBeenCalled();
  });
});
