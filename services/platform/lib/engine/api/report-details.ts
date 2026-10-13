/**
 * What of a test's run a caller may ask a suite's report to keep, beside how
 * the run ended. A leaf: the tool inventory takes the names from here
 * without loading the engine.
 */
export const REPORT_DETAILS = ['output', 'effects', 'trace'] as const;
export type ReportDetail = (typeof REPORT_DETAILS)[number];
