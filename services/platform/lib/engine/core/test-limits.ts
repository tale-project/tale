/**
 * The limits an automation's tests are held to: how many one automation
 * carries — every save and every deploy runs them all — and how long one
 * test, and a whole suite of them, may run.
 */

/** The most tests one automation carries. */
export const MAX_TESTS = 50;

/** How long one test may run before it is stopped and fails. */
export const TEST_DEADLINE_MS = 10_000;

/** How long a suite of tests may run; the tests it does not reach are not
 * run, and count as failed. */
export const SUITE_DEADLINE_MS = 60_000;
