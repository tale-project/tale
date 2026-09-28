// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { render, screen } from '@/tests/utils/render';

interface TestBudgetWarning {
  code: 'TOKEN_WARNING' | 'COST_WARNING' | 'REQUEST_WARNING';
  scope?: 'user' | 'org' | 'apiKey';
  period: string;
  used: number;
  limit: number;
  percent: number;
}

interface TestBudgetStatus {
  exceeded: boolean;
  code: 'TOKEN_LIMIT' | 'COST_LIMIT' | 'REQUEST_LIMIT' | null;
  period: string | null;
  used: number | null;
  limit: number | null;
  reason: string | null;
  warnings: TestBudgetWarning[] | null;
}

const budgetStatusMock = vi.hoisted(() => ({
  value: null as unknown,
}));

vi.mock('../../settings/governance/hooks/queries', () => ({
  useMyBudgetStatus: () => ({ data: budgetStatusMock.value }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    className,
  }: {
    children: ReactNode;
    to: string;
    params: { id: string };
    className?: string;
  }) => (
    <a href={to.replace('$id', params.id)} className={className}>
      {children}
    </a>
  ),
}));

import { BudgetBanner } from './budget-banner';

const TOKEN_WARNING: TestBudgetWarning = {
  code: 'TOKEN_WARNING',
  period: 'monthly',
  used: 8000,
  limit: 10_000,
  percent: 80,
};

const WARNING_STATUS: TestBudgetStatus = {
  exceeded: false,
  code: null,
  period: null,
  used: null,
  limit: null,
  reason: null,
  warnings: [TOKEN_WARNING],
};

const EXCEEDED_STATUS: TestBudgetStatus = {
  exceeded: true,
  code: 'COST_LIMIT',
  period: 'monthly',
  used: 520,
  limit: 400,
  reason: 'Cost limit exceeded',
  warnings: null,
};

describe('BudgetBanner', () => {
  beforeEach(() => {
    budgetStatusMock.value = null;
  });

  it('renders the warning tint while a budget is only approached', () => {
    budgetStatusMock.value = WARNING_STATUS;
    render(<BudgetBanner organizationId="org-1" />);

    expect(
      screen.getByText(/2,000 of 10,000 token left this month/),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveClass(
      'bg-amber-50',
      'border-amber-500/30',
    );
  });

  it("labels an organization-bucket warning as the organization's, not the reader's", () => {
    budgetStatusMock.value = {
      ...WARNING_STATUS,
      warnings: [
        {
          code: 'COST_WARNING',
          scope: 'org',
          period: 'monthly',
          used: 8_500,
          limit: 10_000,
          percent: 85,
        },
      ],
    };
    render(<BudgetBanner organizationId="org-1" />);

    expect(
      screen.getByText(
        /Organization: \$15\.00 of \$100\.00 cost left this month/,
      ),
    ).toBeInTheDocument();
  });

  it('renders the destructive tint once the budget is exceeded', () => {
    budgetStatusMock.value = EXCEEDED_STATUS;
    render(<BudgetBanner organizationId="org-1" />);

    expect(screen.getByRole('alert')).toHaveClass(
      'bg-destructive/10',
      'border-destructive/25',
    );
    // The accent lives on the fill and the glyph: red copy on the pink
    // tint fails AA contrast in light mode.
    const message = screen.getByText(/Usage limit reached · resets monthly/);
    expect(message).toHaveClass('text-foreground');
    expect(message).not.toHaveClass('text-destructive');
    expect(message).toHaveAttribute(
      'title',
      'cost limit reached for this month ($5.20 / $4.00). Contact your administrator.',
    );
    // A hard block is not dismissible — the way out is asking for credits.
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Request usage credits' }),
    ).toBeInTheDocument();
  });

  it.each([
    ['approached', WARNING_STATUS],
    ['exceeded', EXCEEDED_STATUS],
  ])(
    'sits in the composer column as an announced design-system alert while a budget is %s',
    (_state, status) => {
      budgetStatusMock.value = status;
      render(<BudgetBanner organizationId="org-1" />);

      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('aria-live', 'polite');
      expect(alert).toHaveClass('mx-auto', 'max-w-3xl', 'rounded-lg', 'border');
    },
  );

  it.each([
    ['daily', /left today$/, /resets daily$/],
    ['weekly', /left this week$/, /resets weekly$/],
    ['monthly', /left this month$/, /resets monthly$/],
  ])('phrases a %s period the way a reader says it', (period, left, resets) => {
    budgetStatusMock.value = {
      ...WARNING_STATUS,
      warnings: [{ ...TOKEN_WARNING, period }],
    };
    const approached = render(<BudgetBanner organizationId="org-1" />);
    expect(screen.getByText(left)).toBeInTheDocument();
    approached.unmount();

    budgetStatusMock.value = { ...EXCEEDED_STATUS, period };
    render(<BudgetBanner organizationId="org-1" />);
    expect(screen.getByText(resets)).toBeInTheDocument();
  });

  // The shell's locale sync pins the rendered language, so the sibling
  // catalogs are proved through the instance: the period is an enum on the
  // wire and each locale phrases it, never echoes it.
  const AMOUNTS = { remaining: '2,000', limit: '10,000' };
  const FIGURES = { used: '$5.20', limit: '$4.00' };
  it.each([
    [
      'de',
      'budgetLimitReached',
      { period: 'daily' },
      'Nutzungslimit erreicht · wird täglich zurückgesetzt',
    ],
    [
      'de',
      'budgetLimitReached',
      { period: 'monthly' },
      'Nutzungslimit erreicht · wird monatlich zurückgesetzt',
    ],
    [
      'de',
      'budgetRemaining',
      { ...AMOUNTS, type: 'Token', period: 'weekly' },
      'Noch 2,000 von 10,000 Token in dieser Woche',
    ],
    [
      'de',
      'budgetExceededDetail',
      { ...FIGURES, type: 'Kosten', period: 'daily' },
      'Kosten-Limit für heute erreicht ($5.20 / $4.00). Wende dich an deinen Administrator.',
    ],
    [
      'fr',
      'budgetLimitReached',
      { period: 'daily' },
      "Limite d'utilisation atteinte · se réinitialise chaque jour",
    ],
    [
      'fr',
      'budgetLimitReached',
      { period: 'weekly' },
      "Limite d'utilisation atteinte · se réinitialise chaque semaine",
    ],
    // The apostrophe sits inside an ICU select branch — literal, not a quote.
    [
      'fr',
      'budgetRemaining',
      { ...AMOUNTS, type: 'token', period: 'daily' },
      "Encore 2,000 sur 10,000 token aujourd'hui",
    ],
    [
      'fr',
      'budgetExceededDetail',
      { ...FIGURES, type: 'coût', period: 'monthly' },
      'Limite de coût atteinte pour ce mois-ci ($5.20 / $4.00). Contacte ton administrateur.',
    ],
  ])(
    'phrases the %s copy of %s for %o in the locale, not the enum',
    (locale, key, values, expected) => {
      const t = i18n.getFixedT(locale, 'chat');

      expect(t(key, values)).toBe(expected);
    },
  );

  it.each([
    ['approached', WARNING_STATUS],
    ['exceeded', EXCEEDED_STATUS],
  ])('links to the usage page while a budget is %s', (_state, status) => {
    budgetStatusMock.value = status;
    render(<BudgetBanner organizationId="org-1" />);

    expect(screen.getByRole('link', { name: 'View usage' })).toHaveAttribute(
      'href',
      '/dashboard/org-1/settings/usage',
    );
  });

  it('hides after dismiss', async () => {
    budgetStatusMock.value = WARNING_STATUS;
    const { user } = render(<BudgetBanner organizationId="org-1" />);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText(/left this month/)).toBeNull();
  });

  it('renders nothing without a budget status', () => {
    const { container } = render(<BudgetBanner organizationId="org-1" />);

    expect(container).toBeEmptyDOMElement();
  });
});
