/**
 * How a saved version's tests went, as a version row says it: how many
 * passed of how many, which act checked them and when — or the bare verdict,
 * for a version checked before the counts were kept.
 */

/** A version's test check, as the version history answers it. */
export interface VersionTests {
  testsPassed: boolean | null;
  testsCheckedAt?: number | null;
  tests?: {
    passed: number;
    failed: number;
    total: number;
    via?: 'save' | 'deploy' | 'manual';
  } | null;
}

/** The row's words: the result, and how and when it was checked; null for
 * a version no check left a verdict on. A check kept without its counts
 * says the row's own `verdict`. */
export function versionTestsWords(
  entry: VersionTests,
  ctx: {
    t: (key: string, options?: Record<string, unknown>) => string;
    formatDate: (date: Date) => string;
    verdict: (passed: boolean) => string;
  },
): { summary: string; checked?: string } | null {
  if (entry.testsPassed === null) return null;
  const tests = entry.tests ?? null;
  const summary =
    tests === null || tests.total === 0
      ? ctx.verdict(entry.testsPassed)
      : ctx.t('versions.testsCount', {
          passed: tests.passed,
          total: tests.total,
        });
  const at = entry.testsCheckedAt ?? null;
  if (at === null) return { summary };
  return {
    summary,
    checked: ctx.t('versions.testsChecked', {
      via: tests?.via ?? 'other',
      date: ctx.formatDate(new Date(at)),
    }),
  };
}
