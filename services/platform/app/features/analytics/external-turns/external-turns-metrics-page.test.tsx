import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ExternalTurnMetricsPage } from './external-turns-metrics-page';

// Prop-driven render assertion: the metrics query is the page's only data
// source, so mocking it leaves a genuine component-tier render assertion. A
// populated payload makes the cards + per-harness table render loaded values.
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({
    data: {
      periodDays: 30,
      capped: false,
      total: 20,
      completed: 15,
      failed: 3,
      cancelled: 1,
      timeout: 1,
      recovered: 2,
      successRate: 15 / 19,
      timeoutRate: 1 / 19,
      durationP50Ms: 4000,
      durationP95Ms: 12000,
      spentCents: 250,
      byHarness: [
        {
          harness: 'claude-code',
          total: 12,
          completed: 10,
          failed: 1,
          timeout: 1,
          successRate: 10 / 12,
        },
      ],
    },
    isLoading: false,
  }),
}));

describe('ExternalTurnMetricsPage', () => {
  it('renders the title, period control, SLO cards, and per-harness row', () => {
    render(
      <ExternalTurnMetricsPage
        organizationId="org-1"
        periodDays={30}
        onChangePeriod={() => undefined}
      />,
    );

    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();

    // Six SLO cards in a filled 3×2 strip.
    expect(screen.getByText('79%')).toBeInTheDocument();
    expect(screen.getByText('12.0s')).toBeInTheDocument();
    expect(
      screen.getByText('Total turns').closest('[class*="grid"]'),
    ).toHaveClass('md:grid-cols-3');

    // The per-harness table row.
    expect(screen.getByText('claude-code')).toBeInTheDocument();
    // 10/12 ≈ 83%.
    expect(screen.getByText('83%')).toBeInTheDocument();
  });

  it('passes an axe audit in its loaded state', async () => {
    const { container } = render(
      <ExternalTurnMetricsPage
        organizationId="org-1"
        periodDays={30}
        onChangePeriod={() => undefined}
      />,
    );
    await checkAccessibility(container);
  });
});
