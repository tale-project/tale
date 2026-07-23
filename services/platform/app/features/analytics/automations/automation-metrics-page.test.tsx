import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { AutomationMetricsPage } from './automation-metrics-page';

// Pure, prop-driven render assertion (mirrors the usage metrics page test):
// the metrics query is the page's only data source, so mocking it away leaves
// a genuine UI render assertion at the component tier. We supply a populated
// summary so the cards and table render loaded values rather than their
// skeleton masks. Labels come from i18n keys pending central merge, so the
// assertions pin locale-independent output (formatted values, control labels
// that already exist) rather than card label strings.
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({
    data: {
      summary: {
        total: 42,
        success: 30,
        failed: 8,
        running: 1,
        waiting: 1,
        queued: 1,
        cancelled: 1,
        successRate: 76.9,
        avgDurationSeconds: 90,
        lastRun: Date.now(),
        capped: false,
      },
      previousSummary: {
        total: 20,
        success: 15,
        failed: 5,
        successRate: 75,
        avgDurationSeconds: 60,
      },
      series: [],
      topAutomations: [
        {
          name: 'billing/reminder',
          total: 12,
          success: 10,
          failed: 2,
          successRate: 83.3,
          avgDurationSeconds: 45,
          lastRun: Date.now(),
        },
      ],
    },
    isLoading: false,
  }),
}));

// The nested DataTable reads the org id from the router; outside a
// RouterProvider that hook throws, so stub it like the other component tests.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

describe('AutomationMetricsPage', () => {
  it('renders the title heading, period control, summary values, and top automations', () => {
    render(
      <AutomationMetricsPage
        organizationId="org-1"
        periodDays={30}
        onChangePeriod={() => undefined}
        onSelectAutomation={() => undefined}
      />,
    );

    // MetricsLayout renders the page title as an h3 (chart cards and the
    // table section add their own h3s).
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(
      0,
    );

    // The period Select control, addressed by its accessible label. Its
    // presence proves the page rendered past its skeleton.
    expect(screen.getByLabelText('Period')).toBeInTheDocument();

    // Loaded summary-card values (total runs, success rate, avg duration).
    // '42' also renders as the status donut's center total.
    expect(screen.getAllByText('42').length).toBeGreaterThan(0);
    expect(screen.getByText('76.9%')).toBeInTheDocument();
    expect(screen.getByText('1m 30s')).toBeInTheDocument();

    // Top-automations table row.
    expect(screen.getByText('billing/reminder')).toBeInTheDocument();
  });

  it('passes axe audit in its loaded state', async () => {
    const { container } = render(
      <AutomationMetricsPage
        organizationId="org-1"
        periodDays={30}
        onChangePeriod={() => undefined}
        onSelectAutomation={() => undefined}
      />,
    );
    await checkAccessibility(container);
  });
});
