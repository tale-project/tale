import { describe, expect, it } from 'vitest';

import { testsOf } from './test-draft';
import {
  keepResults,
  NO_KEPT_RESULTS,
  outcomeOf,
  resultsAfterInsert,
  resultsAfterRemove,
  subjectHashOf,
  testStatusOf,
  type KeptTestResult,
  type TestRunReport,
} from './test-results';

const DOC = {
  name: 'double',
  nodes: [{ id: 'double', type: 'transform', code: 'return input.n * 2;' }],
  output: '{{ nodes.double.output }}',
  tests: [
    { name: 'doubles seven', input: { n: 7 }, expect: { output: 14 } },
    { name: 'triples seven', input: { n: 7 }, expect: { output: 21 } },
  ],
};

const REPORT: TestRunReport = {
  passed: 1,
  failed: 1,
  results: [
    { name: 'doubles seven', index: 0, pass: true, ms: 3 },
    {
      name: 'triples seven',
      index: 1,
      pass: false,
      ms: 4,
      failures: [{ kind: 'output', mode: 'exact', mismatches: [], total: 1 }],
    },
  ],
};

function edited(test: Record<string, unknown>, at: number) {
  const tests = [...DOC.tests];
  tests[at] = test as (typeof tests)[number];
  return { ...DOC, tests };
}

describe('what a test’s result is judged against', () => {
  it('names the automation without its tests', () => {
    expect(subjectHashOf(DOC)).toBe(
      subjectHashOf({ ...DOC, tests: [{ name: 'other', input: {} }] }),
    );
    expect(subjectHashOf(DOC)).not.toBe(
      subjectHashOf({ ...DOC, output: '{{ input.n }}' }),
    );
  });
});

describe('keeping results', () => {
  it('puts each result at its test’s place, and keeps the places not run', () => {
    const first = keepResults(NO_KEPT_RESULTS, REPORT, DOC, 100);
    expect(first[0]?.result.pass).toBe(true);
    expect(first[1]?.result.pass).toBe(false);
    const again = keepResults(
      first,
      { passed: 1, failed: 0, results: [{ ...REPORT.results[0]!, ms: 9 }] },
      DOC,
      200,
    );
    expect(again[0]).toMatchObject({ at: 200, result: { ms: 9 } });
    expect(again[1]).toBe(first[1]);
  });

  it('moves results with their tests when one is removed or inserted', () => {
    const kept = keepResults(NO_KEPT_RESULTS, REPORT, DOC, 100);
    const removed = resultsAfterRemove(kept, 0);
    expect(Object.keys(removed)).toEqual(['0']);
    expect(removed[0]?.result.name).toBe('triples seven');
    const inserted = resultsAfterInsert(kept, 1);
    expect(Object.keys(inserted)).toEqual(['0', '2']);
    expect(inserted[2]?.result.name).toBe('triples seven');
  });
});

describe('where a test stands', () => {
  const kept = keepResults(NO_KEPT_RESULTS, REPORT, DOC, 100);
  const outcome = (doc: typeof DOC, index: number, entry = kept[index]) =>
    outcomeOf({
      index,
      test: testsOf(doc)[index],
      subjectHash: subjectHashOf(doc),
      kept: entry,
      report: null,
    });

  it('holds while neither the automation nor the test changed', () => {
    expect(testStatusOf(outcome(DOC, 0), false)).toBe('passed');
    expect(testStatusOf(outcome(DOC, 1), false)).toBe('failed');
    expect(testStatusOf(outcome(DOC, 1), true)).toBe('running');
  });

  it('is changed since when the automation changed, or the test itself', () => {
    const code = { ...DOC, output: '{{ input.n }}' };
    expect(testStatusOf(outcome(code, 0), false)).toBe('stale');
    // Editing one test leaves another test's result standing.
    const other = edited({ ...DOC.tests[1], expect: { output: 14 } }, 1);
    expect(testStatusOf(outcome(other, 0), false)).toBe('passed');
    expect(testStatusOf(outcome(other, 1), false)).toBe('stale');
  });

  it('has none before a run, and could not run when the run was refused', () => {
    // An absent result reads as none: no default stands in for it.
    const none = outcomeOf({
      index: 0,
      test: DOC.tests[0],
      subjectHash: subjectHashOf(DOC),
      kept: undefined,
      report: null,
    });
    expect(testStatusOf(none, false)).toBe('not-run');
    const refused: KeptTestResult = {
      ...kept[1]!,
      result: {
        name: 'triples seven',
        index: 1,
        pass: false,
        ms: 1,
        failures: [{ kind: 'refused', issues: [] }],
      },
    };
    expect(testStatusOf(outcome(DOC, 1, refused), false)).toBe('error');
  });

  it('reads the version’s kept report when it is newer than this page’s run', () => {
    const report = {
      checkedAt: 500,
      passed: 0,
      failed: 1,
      results: [
        {
          name: 'doubles seven',
          index: 0,
          pass: false,
          ms: 2,
          failures: [{ kind: 'timeout' as const, limitMs: 10_000 }],
        },
      ],
    };
    const read = outcomeOf({
      index: 0,
      test: DOC.tests[0],
      subjectHash: subjectHashOf(DOC),
      kept: kept[0],
      report: { report, document: DOC },
    });
    expect(read).toMatchObject({ kind: 'report', stale: false, at: 500 });
    // This page's newer run wins over an older report.
    const older = outcomeOf({
      index: 0,
      test: DOC.tests[0],
      subjectHash: subjectHashOf(DOC),
      kept: { ...kept[0]!, at: 900 },
      report: { report, document: DOC },
    });
    expect(older.kind).toBe('run');
    // A draft that moved past the version: the report no longer holds.
    const draft = { ...DOC, output: '{{ input.n }}' };
    expect(
      outcomeOf({
        index: 0,
        test: draft.tests[0],
        subjectHash: subjectHashOf(draft),
        kept: undefined,
        report: { report, document: DOC },
      }),
    ).toMatchObject({ kind: 'report', stale: true });
  });
});
