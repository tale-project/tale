import { describe, expect, it } from 'vitest';

import { i18n } from '@/tests/utils/i18n-all-languages';

import { type VersionTests, versionTestsWords } from './version-tests';

const AT = Date.UTC(2026, 9, 11, 15, 42);

function words(entry: VersionTests, locale = 'en') {
  const t = i18n.getFixedT(locale, 'automations');
  return versionTestsWords(entry, {
    t,
    formatDate: (date) => `[${date.toISOString()}]`,
    verdict: (passed) =>
      t(passed ? 'versions.testsPassed' : 'versions.testsFailed'),
  });
}

describe('versionTestsWords', () => {
  it('says nothing for a version no check left a verdict on', () => {
    expect(words({ testsPassed: null, testsCheckedAt: null })).toBeNull();
  });

  it('counts what passed of how many, and which act checked it when', () => {
    expect(
      words({
        testsPassed: false,
        testsCheckedAt: AT,
        tests: { passed: 2, failed: 1, total: 3, via: 'save' },
      }),
    ).toEqual({
      summary: '2 of 3 tests passed',
      checked: 'checked on save · [2026-10-11T15:42:00.000Z]',
    });
    expect(
      words({
        testsPassed: true,
        testsCheckedAt: AT,
        tests: { passed: 1, failed: 0, total: 1, via: 'deploy' },
      }),
    ).toEqual({
      summary: '1 of 1 test passed',
      checked: 'checked on deploy · [2026-10-11T15:42:00.000Z]',
    });
    expect(
      words({
        testsPassed: true,
        testsCheckedAt: AT,
        tests: { passed: 4, failed: 0, total: 4, via: 'manual' },
      })?.checked,
    ).toBe('checked by hand · [2026-10-11T15:42:00.000Z]');
  });

  it('keeps to the bare verdict, and claims no act, for a check kept without its counts', () => {
    expect(
      words({ testsPassed: false, testsCheckedAt: AT, tests: null }),
    ).toEqual({
      summary: 'Tests failed',
      checked: 'checked · [2026-10-11T15:42:00.000Z]',
    });
    expect(
      words({
        testsPassed: true,
        tests: { passed: 0, failed: 0, total: 0, via: 'save' },
      }),
    ).toEqual({ summary: 'Tests passed' });
  });

  it('says it in German and French', () => {
    const counts = { passed: 1, failed: 2, total: 3, via: 'deploy' } as const;
    const entry: VersionTests = {
      testsPassed: false,
      testsCheckedAt: AT,
      tests: counts,
    };
    expect(words(entry, 'de')).toEqual({
      summary: '1 von 3 Tests bestanden',
      checked: 'beim Live-Schalten geprüft · [2026-10-11T15:42:00.000Z]',
    });
    expect(words(entry, 'fr')).toEqual({
      summary: '1 test sur 3 réussi',
      checked: 'vérifié à la mise en service · [2026-10-11T15:42:00.000Z]',
    });
    expect(
      words({ ...entry, tests: { ...counts, passed: 0, failed: 3 } }, 'fr')
        ?.summary,
    ).toBe('0 test sur 3 réussi');
  });
});
