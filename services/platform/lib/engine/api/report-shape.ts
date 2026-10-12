/**
 * A suite's report as an answer carries it. A test's run — what it ended
 * in, what it returned, the effects it made and its record step by step —
 * can be far larger than the verdict beside it, so an answer keeps the runs a
 * caller asked for, as far as they fit, and says of a run it left out that
 * it did (`detailOmitted`): run that test alone to read its steps.
 */

import { jsonBytes } from '../../shared/utils/json-bytes';
import type { ReportDetail } from './report-details';
import type { TestReport, TestResult, TestRunDetail } from './tests';

export interface ReportLimits {
  /** The most one test's run may hold, as UTF-8 JSON. */
  runBytes: number;
  /** The most the runs of one answer may hold together. */
  totalBytes: number;
}

/**
 * The report with each test's run kept when it fits `runBytes` and the runs
 * kept so far, with it, stay within `totalBytes`; a run that does not fit is
 * left out and the result says so.
 */
export function boundedReport(
  report: TestReport,
  limits: ReportLimits,
): TestReport {
  let kept = 0;
  return {
    ...report,
    results: report.results.map((result) => {
      if (result.run === undefined) return result;
      const bytes = jsonBytes(result.run);
      if (bytes <= limits.runBytes && kept + bytes <= limits.totalBytes) {
        kept += bytes;
        return result;
      }
      const { run: _run, ...rest } = result;
      return { ...rest, detailOmitted: true };
    }),
  };
}

/** A run as asked: how it ended — its status, its error, a stop — and only
 * the parts of `keep`. */
function runAsked(
  run: TestRunDetail,
  keep: ReadonlySet<ReportDetail>,
): TestRunDetail {
  return {
    status: run.status,
    ...(run.error !== undefined && { error: run.error }),
    ...(run.stoppedBy !== undefined && { stoppedBy: run.stoppedBy }),
    ...(keep.has('output') &&
      run.output !== undefined && { output: run.output }),
    ...(keep.has('effects') &&
      run.effects !== undefined && { effects: run.effects }),
    ...(keep.has('trace') &&
      run.record !== undefined && { record: run.record }),
  };
}

/** The report with each run cut to the parts of `keep`. */
export function reportWithDetail(
  report: TestReport,
  keep: ReadonlySet<ReportDetail>,
): TestReport {
  return {
    ...report,
    results: report.results.map((result): TestResult =>
      result.run === undefined
        ? result
        : { ...result, run: runAsked(result.run, keep) },
    ),
  };
}
