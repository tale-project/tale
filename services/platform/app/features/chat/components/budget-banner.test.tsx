// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

interface TestBudgetWarning {
  code: 'TOKEN_WARNING' | 'COST_WARNING' | 'REQUEST_WARNING';
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

import { BudgetBanner } from './budget-banner';

const WARNING_STATUS: TestBudgetStatus = {
  exceeded: false,
  code: null,
  period: null,
  used: null,
  limit: null,
  reason: null,
  warnings: [
    {
      code: 'TOKEN_WARNING',
      period: 'monthly',
      used: 8000,
      limit: 10_000,
      percent: 80,
    },
  ],
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

    const message = screen.getByText(
      /You have used 80% of your monthly token limit/,
    );
    expect(message.closest('div')).toHaveClass(
      'bg-warning/10',
      'border-warning/30',
    );
  });

  it('renders the destructive tint once the budget is exceeded', () => {
    budgetStatusMock.value = EXCEEDED_STATUS;
    render(<BudgetBanner organizationId="org-1" />);

    const message = screen.getByText(
      /cost limit reached for this monthly period \(\$5\.20 \/ \$4\.00\)/,
    );
    expect(message.closest('div')).toHaveClass(
      'bg-destructive/10',
      'border-destructive/30',
    );
  });

  it('hides after dismiss', async () => {
    budgetStatusMock.value = WARNING_STATUS;
    const { user } = render(<BudgetBanner organizationId="org-1" />);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText(/You have used 80%/)).toBeNull();
  });

  it('renders nothing without a budget status', () => {
    const { container } = render(<BudgetBanner organizationId="org-1" />);

    expect(container).toBeEmptyDOMElement();
  });
});
