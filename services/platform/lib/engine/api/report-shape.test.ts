import { describe, expect, it } from 'vitest';

import { jsonBytes } from '../../shared/utils/json-bytes';
import type { ReportDetail } from './report-details';
import { boundedReport, reportWithDetail } from './report-shape';
import type { TestReport, TestResult } from './tests';

/**
 * What an answer keeps of a suite's runs: the parts of each run a caller
 * asked for, as many of them as fit, with the runs left out said so.
 */

const result = (name: string, run?: TestResult['run']): TestResult => ({
  name,
  index: 0,
  pass: true,
  ms: 1,
  ...(run !== undefined && { run }),
});

const report = (...results: TestResult[]): TestReport => ({
  passed: results.length,
  failed: 0,
  results,
});

const run = (output: unknown): NonNullable<TestResult['run']> => ({
  status: 'success',
  output,
  effects: [],
});

describe('boundedReport', () => {
  const limits = { runBytes: 100, totalBytes: 150 };

  it('keeps a run that fits and leaves a result without one as it is', () => {
    const small = result('small', run('ok'));
    const bare = result('bare');
    expect(boundedReport(report(small, bare), limits).results).toEqual([
      small,
      bare,
    ]);
  });

  it('leaves out a run past the limit of one run, and says so', () => {
    const [kept] = boundedReport(
      report(result('big', run('x'.repeat(200)))),
      limits,
    ).results;
    expect(kept).toEqual({
      name: 'big',
      index: 0,
      pass: true,
      ms: 1,
      detailOmitted: true,
    });
  });

  it('leaves out the runs that no longer fit the whole answer, counting what it kept only', () => {
    const one = jsonBytes(run('x'.repeat(10)));
    const fits = (name: string) => result(name, run('x'.repeat(10)));
    // Room for two of them, with a little to spare.
    const room = { runBytes: 100, totalBytes: one * 2 + 10 };
    const answered = boundedReport(
      report(
        fits('first'),
        // Past the limit of one run: left out, and not counted.
        result('huge', run('x'.repeat(500))),
        fits('second'),
        fits('third'),
        fits('fourth'),
      ),
      room,
    ).results;
    expect(answered.map((r) => r.detailOmitted === true)).toEqual([
      false,
      true,
      false,
      true,
      true,
    ]);
    expect(answered.map((r) => r.run !== undefined)).toEqual([
      true,
      false,
      true,
      false,
      false,
    ]);
  });

  it('keeps the counts and the tests that were not run', () => {
    const whole: TestReport = {
      passed: 1,
      failed: 1,
      results: [result('a', run('x'.repeat(500)))],
      notRun: ['b'],
    };
    expect(boundedReport(whole, limits)).toMatchObject({
      passed: 1,
      failed: 1,
      notRun: ['b'],
    });
  });
});

describe('reportWithDetail', () => {
  const full: NonNullable<TestResult['run']> = {
    status: 'error',
    output: { total: 3 },
    error: { message: 'the mail server is down', nodeId: 'send' },
    effects: [{ node: 'send', connector: 'email', input: {} }],
    stoppedBy: 'time_limit',
    record: { id: 'test-0', nodes: [] } as never,
  };

  it.each<[ReportDetail[], string[]]>([
    [[], ['status', 'error', 'stoppedBy']],
    [['output'], ['status', 'error', 'stoppedBy', 'output']],
    [['effects'], ['status', 'error', 'stoppedBy', 'effects']],
    [['trace'], ['status', 'error', 'stoppedBy', 'record']],
    [
      ['output', 'effects', 'trace'],
      ['status', 'error', 'stoppedBy', 'output', 'effects', 'record'],
    ],
  ])('for detail %j keeps %j of a run', (detail, kept) => {
    const [only] = reportWithDetail(
      report(result('a', full)),
      new Set(detail),
    ).results;
    expect(Object.keys(only?.run ?? {}).toSorted()).toEqual(kept.toSorted());
  });

  it('always keeps how a run ended, and the verdict beside it', () => {
    const failing: TestResult = {
      name: 'a',
      index: 2,
      pass: false,
      message: 'run error: boom',
      failures: [{ kind: 'timeout', limitMs: 10_000 }],
      ms: 4,
      run: full,
    };
    const [only] = reportWithDetail(report(failing), new Set()).results;
    expect(only).toMatchObject({
      name: 'a',
      index: 2,
      pass: false,
      message: 'run error: boom',
      failures: [{ kind: 'timeout', limitMs: 10_000 }],
      run: { status: 'error', error: full.error, stoppedBy: 'time_limit' },
    });
  });

  it('leaves a result without a run as it is', () => {
    const bare = result('bare');
    expect(reportWithDetail(report(bare), new Set(['output'])).results).toEqual(
      [bare],
    );
  });
});
