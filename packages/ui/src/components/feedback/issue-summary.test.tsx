import { describe, expect, it } from 'vitest';

import { initServiceI18n } from '@/i18n/init-service';
import { uiMessages } from '@/i18n/messages';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { CountBadge } from './count-badge';
import { formatIssueCounts, IssueCountButton } from './issue-summary';

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

describe('formatIssueCounts', () => {
  it.each([
    ['en', 0, 0, 'No problems'],
    ['en', 1, 0, '1 error'],
    ['en', 2, 0, '2 errors'],
    ['en', 0, 1, '1 warning'],
    ['en', 0, 2, '2 warnings'],
    ['en', 1, 1, '1 error and 1 warning'],
    ['en', 2, 3, '2 errors and 3 warnings'],
    ['de', 0, 0, 'Keine Probleme'],
    ['de', 1, 0, '1 Fehler'],
    ['de', 2, 1, '2 Fehler und 1 Warnung'],
    ['de', 0, 2, '2 Warnungen'],
    ['fr', 0, 0, 'Aucun problème'],
    ['fr', 1, 0, '1 erreur'],
    ['fr', 2, 1, '2 erreurs et 1 avertissement'],
    ['fr', 1, 2, '1 erreur et 2 avertissements'],
  ])('%s: %i errors, %i warnings → %s', (locale, errors, warnings, text) => {
    expect(formatIssueCounts(inLocale(locale), { errors, warnings })).toBe(
      text,
    );
  });

  it('reads a negative or fractional count as a whole number from zero', () => {
    expect(
      formatIssueCounts(inLocale('en'), { errors: -3, warnings: 1.7 }),
    ).toBe('1 warning');
  });
});

describe('IssueCountButton', () => {
  it('shows the counts as numbers and names them in words', () => {
    render(<IssueCountButton counts={{ errors: 2, warnings: 1 }} />);
    const button = screen.getByRole('button', {
      name: 'Problems: 2 errors and 1 warning',
    });
    expect(button).toHaveTextContent('21');
  });

  it('hides the side that is zero', () => {
    render(<IssueCountButton counts={{ errors: 0, warnings: 3 }} />);
    const button = screen.getByRole('button', { name: 'Problems: 3 warnings' });
    expect(button).toHaveTextContent(/^3$/);
  });

  it('says "No problems" in text and name when both are zero', () => {
    render(<IssueCountButton counts={{ errors: 0, warnings: 0 }} />);
    expect(
      screen.getByRole('button', { name: 'No problems' }),
    ).toHaveTextContent('No problems');
  });

  it('keeps the last counts beside "Checking…" while a check runs', () => {
    render(
      <IssueCountButton
        counts={{ errors: 1, warnings: 0 }}
        status="checking"
      />,
    );
    const button = screen.getByRole('button', {
      name: 'Problems: 1 error. Checking…',
    });
    expect(button).toHaveTextContent('Checking…1');
  });

  it('says it could not check', () => {
    render(
      <IssueCountButton counts={{ errors: 1, warnings: 0 }} status="failed" />,
    );
    expect(
      screen.getByRole('button', { name: "Problems: couldn't check" }),
    ).toHaveTextContent("Couldn't check");
  });

  it('reports what it toggles', () => {
    render(
      <IssueCountButton
        counts={{ errors: 1, warnings: 0 }}
        expanded
        controls="problems-panel"
      />,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', 'problems-panel');
  });

  it("pops a changed count with CountBadge's recipe, still under reduced motion", () => {
    const { container, rerender } = render(
      <IssueCountButton counts={{ errors: 1, warnings: 0 }} />,
    );
    const first = container.querySelector('.animate-in');
    expect(first).toHaveClass('zoom-in-50', 'motion-reduce:animate-none');
    rerender(<IssueCountButton counts={{ errors: 2, warnings: 0 }} />);
    // A new number is a new node, so the pop plays again.
    expect(container.querySelector('.animate-in')).not.toBe(first);
    // The badge it borrows from keeps the same pair.
    const { container: badge } = render(<CountBadge count={1} />);
    expect(badge.firstElementChild).toHaveClass(
      'zoom-in-50',
      'motion-reduce:animate-none',
    );
  });

  it('passes axe in each state', async () => {
    const { container } = render(
      <div>
        <IssueCountButton counts={{ errors: 2, warnings: 1 }} />
        <IssueCountButton counts={{ errors: 0, warnings: 0 }} />
        <IssueCountButton
          counts={{ errors: 2, warnings: 1 }}
          status="checking"
        />
        <IssueCountButton counts={{ errors: 2, warnings: 1 }} status="failed" />
      </div>,
    );
    await checkAccessibility(container);
  });
});
