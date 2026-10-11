/**
 * What the editor knows about each test's last result, and whether it
 * still holds for the draft on screen.
 *
 * Two sources: the results of tests run in this session (kept per
 * automation, `../../hooks/use-test-results`), each with the run's detail,
 * and the report the version on screen keeps of its latest check (a save,
 * the deploy gate, someone running them). A result belongs to the document
 * it ran: the automation without its tests, and the test itself. When
 * either changed since, the result is shown as changed since — never as
 * the draft's verdict. Editing one test leaves the others' results alone.
 */

import { valueHash } from '@tale/ui/data/hash';
import type { TestStatus } from '@tale/ui/test-results';
import type { z } from 'zod';

import type {
  StoredTestReport,
  testReportSchema,
} from '@/lib/shared/schemas/automation-tests';

import type { RawDocument } from '../draft-document';
import { testsOf } from './test-draft';

/** A run of tests as the app reads it. */
export type TestRunReport = z.infer<typeof testReportSchema>;
/** One test's result in a run made in this session, with its run. */
export type TestRunResult = TestRunReport['results'][number];
/** One test's result in a version's kept report: no run, and a failure
 * may be its kind alone. */
export type StoredTestResult = StoredTestReport['results'][number];

/** A result of this session's, and what it was judged against. */
export interface KeptTestResult {
  result: TestRunResult;
  /** The document it ran, without its tests. */
  subjectHash: string;
  /** The test as it ran. */
  testHash: string;
  /** When it ran. */
  at: number;
}

/** This session's results, by the test's place in the document. */
export type KeptTestResults = Readonly<Record<number, KeptTestResult>>;

export const NO_KEPT_RESULTS: KeptTestResults = Object.freeze({});

/** The automation a test checks: the document without its tests. */
export function subjectHashOf(raw: RawDocument): string {
  const subject: Record<string, unknown> = { ...raw };
  delete subject.tests;
  return valueHash(subject);
}

/** One test as written. */
function testHashOf(test: unknown): string {
  return valueHash(test ?? null);
}

/**
 * `previous` with the results of `report`, a run of `sent`'s tests made at
 * `at`: each result takes its test's place, and the places it did not run
 * keep what they had.
 */
export function keepResults(
  previous: KeptTestResults,
  report: TestRunReport,
  sent: RawDocument,
  at: number,
): KeptTestResults {
  const tests = testsOf(sent);
  const subjectHash = subjectHashOf(sent);
  const next: Record<number, KeptTestResult> = { ...previous };
  for (const result of report.results) {
    if (result.index < 0 || result.index >= tests.length) continue;
    next[result.index] = {
      result,
      subjectHash,
      testHash: testHashOf(tests[result.index]),
      at,
    };
  }
  return next;
}

/** The results after the test at `index` was removed: the later ones move
 * up one place with their tests. */
export function resultsAfterRemove(
  results: KeptTestResults,
  index: number,
): KeptTestResults {
  const next: Record<number, KeptTestResult> = {};
  for (const [key, kept] of Object.entries(results)) {
    const at = Number(key);
    if (at < index) next[at] = kept;
    else if (at > index) next[at - 1] = kept;
  }
  return next;
}

/** The results after a test was inserted at `index`: the ones from there
 * on move down one place with their tests. */
export function resultsAfterInsert(
  results: KeptTestResults,
  index: number,
): KeptTestResults {
  const next: Record<number, KeptTestResult> = {};
  for (const [key, kept] of Object.entries(results)) {
    const at = Number(key);
    next[at < index ? at : at + 1] = kept;
  }
  return next;
}

/** Where a test stands for the draft on screen. */
export type TestOutcome =
  | { kind: 'none' }
  | {
      kind: 'run';
      result: TestRunResult;
      /** The automation or the test changed since it ran. */
      stale: boolean;
      at: number;
    }
  | {
      kind: 'report';
      result: StoredTestResult;
      stale: boolean;
      at: number;
    };

/** A version's kept report, with the document it judged. */
export interface ReportSource {
  report: StoredTestReport;
  /** The version's own document: what its report's results ran. */
  document: RawDocument;
}

/**
 * Where the test at `index` stands: the newer of this session's result
 * and the version's report, each marked changed since when the automation
 * (without its tests) or the test is no longer what it ran.
 */
export function outcomeOf(args: {
  index: number;
  /** The test as the draft on screen holds it. */
  test: unknown;
  /** The draft on screen, without its tests. */
  subjectHash: string;
  kept: KeptTestResult | undefined;
  report: ReportSource | null;
}): TestOutcome {
  const testHash = testHashOf(args.test);
  const stored =
    args.report === null
      ? undefined
      : args.report.report.results.find(
          (result) => result.index === args.index,
        );
  const storedAt = args.report?.report.checkedAt ?? -Infinity;
  if (args.kept !== undefined && args.kept.at >= storedAt) {
    return {
      kind: 'run',
      result: args.kept.result,
      stale:
        args.kept.subjectHash !== args.subjectHash ||
        args.kept.testHash !== testHash,
      at: args.kept.at,
    };
  }
  if (stored !== undefined && args.report !== null) {
    const document = args.report.document;
    return {
      kind: 'report',
      result: stored,
      stale:
        subjectHashOf(document) !== args.subjectHash ||
        testHashOf(testsOf(document)[args.index]) !== testHash,
      at: storedAt,
    };
  }
  return { kind: 'none' };
}

/** Whether a result could not run the test at all — a refused run — as
 * against one that ran and got something else than expected. */
function couldNotRun(result: TestRunResult | StoredTestResult): boolean {
  return (result.failures ?? []).some((failure) => failure.kind === 'refused');
}

/** A test's status for the list: running while it runs, else from its
 * outcome. */
export function testStatusOf(
  outcome: TestOutcome,
  running: boolean,
): TestStatus {
  if (running) return 'running';
  if (outcome.kind === 'none') return 'not-run';
  if (outcome.stale) return 'stale';
  if (outcome.result.pass) return 'passed';
  return couldNotRun(outcome.result) ? 'error' : 'failed';
}
