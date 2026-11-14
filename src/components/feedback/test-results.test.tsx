import { describe, expect, it } from 'vitest';

import { initServiceI18n } from '@/i18n/init-service';
import { uiMessages } from '@/i18n/messages';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import {
  countTestStatuses,
  formatTestCounts,
  TEST_STATUS,
  TestCountButton,
  TestCoverage,
  TestStatusIcon,
  type TestCounts,
  type TestStatus,
} from './test-results';

const i18n = initServiceI18n({
  bundles: { en: {}, de: {}, fr: {} },
  regional: {},
  packages: [uiMessages],
});

/** A translate function bound to another namespace: the helper names its own. */
const inLocale = (locale: string) => {
  const t = i18n.getFixedT(locale, 'common');
  return (key: string, options?: Record<string, unknown>) => t(key, options);
};

const NONE: TestCounts = {
  passed: 0,
  failed: 0,
  error: 0,
  notRun: 0,
  stale: 0,
  total: 0,
};

const STATUSES = Object.keys(TEST_STATUS) as TestStatus[];

describe('formatTestCounts', () => {
  it.each([
    ['en', {}, 'No tests'],
    ['en', { passed: 2, failed: 1, total: 3 }, '2 passed, 1 failed'],
    ['en', { passed: 1, total: 1 }, '1 passed'],
    ['en', { notRun: 3, total: 3 }, '3 not run yet'],
    [
      'en',
      { passed: 1, failed: 1, error: 1, notRun: 1, stale: 1, total: 5 },
      "1 passed, 1 failed, 1 couldn't run, 1 not run yet, 1 changed since",
    ],
    ['en', { total: 3 }, '3 tests'],
    ['de', {}, 'Keine Tests'],
    ['de', { passed: 2, failed: 1, total: 3 }, '2 bestanden, 1 fehlgeschlagen'],
    ['de', { error: 2, total: 2 }, '2 konnten nicht laufen'],
    ['de', { total: 1 }, '1 Test'],
    ['fr', {}, 'Aucun test'],
    ['fr', { passed: 2, failed: 1, total: 3 }, '2 réussis et 1 échoué'],
    ['fr', { error: 1, total: 1 }, "1 n'a pas pu s'exécuter"],
    ['fr', { notRun: 2, total: 2 }, '2 pas encore exécutés'],
  ])('%s: %o → %s', (locale, counts, text) => {
    expect(
      formatTestCounts(inLocale(locale), { ...NONE, ...counts }, locale),
    ).toBe(text);
  });

  it('reads a negative or fractional count as a whole number from zero', () => {
    expect(
      formatTestCounts(inLocale('en'), {
        ...NONE,
        passed: -3,
        failed: 1.7,
        total: 2,
      }),
    ).toBe('1 failed');
  });
});

describe('countTestStatuses', () => {
  it('counts every status, running and waiting tests in the total only', () => {
    expect(
      countTestStatuses([
        'passed',
        'passed',
        'failed',
        'error',
        'running',
        'queued',
        'not-run',
        'stale',
      ]),
    ).toEqual({
      passed: 2,
      failed: 1,
      error: 1,
      notRun: 1,
      stale: 1,
      total: 8,
    });
  });
});

describe('TestStatusIcon', () => {
  it('gives every status its own glyph and its own word', () => {
    const glyphs = new Set(STATUSES.map((status) => TEST_STATUS[status].icon));
    expect(glyphs.size).toBe(STATUSES.length);
    for (const locale of ['en', 'de', 'fr']) {
      const t = i18n.getFixedT(locale, 'testResults');
      const words = STATUSES.map((status) => t(TEST_STATUS[status].labelKey));
      expect(new Set(words).size).toBe(STATUSES.length);
      for (const word of words) expect(word).not.toMatch(/^status\./);
    }
  });

  it('is decoration without a label and an image with one', () => {
    const { container, rerender } = render(<TestStatusIcon status="failed" />);
    expect(container.querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    rerender(<TestStatusIcon status="failed" label="Failed" />);
    expect(screen.getByRole('img', { name: 'Failed' })).toBeInTheDocument();
  });
});

describe('TestCountButton', () => {
  it('shows the counts as numbers and names them in words', () => {
    render(
      <TestCountButton counts={{ ...NONE, passed: 2, failed: 1, total: 3 }} />,
    );
    const button = screen.getByRole('button', {
      name: 'Tests: 2 passed, 1 failed',
    });
    expect(button).toHaveTextContent('Tests21');
  });

  it('leaves out a status with none', () => {
    render(<TestCountButton counts={{ ...NONE, passed: 4, total: 4 }} />);
    expect(
      screen.getByRole('button', { name: 'Tests: 4 passed' }),
    ).toHaveTextContent(/^Tests4$/);
  });

  it('says "No tests" in its name when there are none', () => {
    render(<TestCountButton counts={NONE} />);
    expect(
      screen.getByRole('button', { name: 'Tests: No tests' }),
    ).toHaveTextContent(/^Tests$/);
  });

  it('keeps the last counts while tests run, the spinner in the flask’s place', () => {
    const counts = { ...NONE, passed: 2, failed: 1, total: 3 };
    const { container, rerender } = render(<TestCountButton counts={counts} />);
    const glyphs = () =>
      [...container.querySelectorAll('svg')].map((svg) =>
        svg.getAttribute('class'),
      );
    expect(glyphs()[0]).toContain('lucide-flask-conical');
    rerender(<TestCountButton counts={counts} status="running" />);
    expect(glyphs()[0]).toContain('motion-safe:animate-spin');
    expect(glyphs()).toHaveLength(3);
    expect(
      screen.getByRole('button', {
        name: 'Tests: 2 passed, 1 failed. Running…',
      }),
    ).toHaveTextContent('Tests21');
  });

  it('says a run that starts before any result is in', () => {
    render(<TestCountButton counts={{ ...NONE, total: 3 }} status="running" />);
    expect(
      screen.getByRole('button', { name: 'Tests: running 3 tests…' }),
    ).toHaveTextContent(/^Tests$/);
  });

  it('says a run that failed', () => {
    render(
      <TestCountButton
        counts={{ ...NONE, passed: 2, total: 2 }}
        status="failed"
      />,
    );
    expect(
      screen.getByRole('button', { name: "Tests: couldn't run" }),
    ).toBeInTheDocument();
  });

  it('wires the panel it toggles', async () => {
    const { container } = render(
      <>
        <TestCountButton counts={NONE} expanded controls="tests-panel" />
        <div id="tests-panel" />
      </>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', 'tests-panel');
    await checkAccessibility(container);
  });
});

describe('TestCoverage', () => {
  it('says how many paths the tests cover, the plural on the total', () => {
    const { rerender } = render(<TestCoverage covered={2} total={3} />);
    expect(screen.getByText('Covers 2 of 3 paths')).toBeInTheDocument();
    rerender(<TestCoverage covered={1} total={1} />);
    expect(screen.getByText('Covers 1 of 1 path')).toBeInTheDocument();
  });

  it('draws a segment per path up to twelve, then one bar', () => {
    const { container, rerender } = render(
      <TestCoverage covered={2} total={3} />,
    );
    const segments = () => container.querySelectorAll('[data-covered]');
    expect(segments()).toHaveLength(3);
    expect(container.querySelectorAll('[data-covered="true"]')).toHaveLength(2);
    rerender(<TestCoverage covered={5} total={20} />);
    expect(segments()).toHaveLength(0);
    expect(screen.getByText('Covers 5 of 20 paths')).toBeInTheDocument();
  });

  it('never claims more than there is, and shows nothing without paths', () => {
    const { container, rerender } = render(
      <TestCoverage covered={9} total={3} />,
    );
    expect(screen.getByText('Covers 3 of 3 paths')).toBeInTheDocument();
    rerender(<TestCoverage covered={0} total={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is a button named by its words when it opens something', async () => {
    let opened = 0;
    const { container } = render(
      <TestCoverage
        covered={2}
        total={3}
        onActivate={() => {
          opened += 1;
        }}
      />,
    );
    const button = screen.getByRole('button', { name: 'Covers 2 of 3 paths' });
    button.click();
    expect(opened).toBe(1);
    await checkAccessibility(container);
  });
});
