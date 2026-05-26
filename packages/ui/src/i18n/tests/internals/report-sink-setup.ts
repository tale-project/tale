/**
 * vitest setupFiles entry that registers an `afterAll` hook to print the
 * report-mode summary at end-of-suite.
 *
 * Usage (in each consumer's `vitest.config.ts`):
 *
 *   test: {
 *     setupFiles: ['@tale/ui/i18n/tests/internals/report-sink-setup'],
 *   }
 */

import { afterAll } from 'vitest';

import { drainAndPrintReport } from './report-sink';

afterAll(() => {
  drainAndPrintReport();
});
