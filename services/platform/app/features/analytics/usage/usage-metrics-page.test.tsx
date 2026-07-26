import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { UsageMetricsPage } from './usage-metrics-page';

// Migrated from the governance E2E "usage: renders the analytics summary cards
// and controls". That test only navigated to the usage route and asserted pure,
// prop-driven render: the page title heading, the period Select control (proving
// the page is past its skeleton), and two static summary-card labels. There is
// no router redirect/loader, no persistence round-trip, and no backend-enforced
// gating in the assertion — the metrics query is the page's only data source, so
// mocking it away leaves a genuine UI render assertion at the component tier.
//
// The page tolerates an undefined/empty payload via `data?.` reads with
// fallbacks; we supply a populated summary so the cards render loaded values
// rather than their skeleton masks.
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({
    data: {
      summary: {
        totalRequests: 12,
        totalTokens: 3456,
        totalCostCents: 789,
        activeUsers: 4,
        capped: false,
      },
      series: [],
      topAgents: [],
      topModels: [],
      topVoiceModels: [],
      users: [],
    },
    isLoading: false,
  }),
}));

// The nested DataTable reads the org id from the router; outside a
// RouterProvider that hook throws, so stub it like the other component tests.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

describe('UsageMetricsPage', () => {
  it('renders the title heading, period control, and summary card labels', () => {
    render(<UsageMetricsPage organizationId="org-1" />);

    // Page title (the E2E asserted this heading by name).
    expect(
      screen.getByRole('heading', { name: 'Usage metrics' }),
    ).toBeInTheDocument();

    // The period Select control, addressed by its accessible label exactly as
    // the E2E did (page.getByLabel(period.label)). Its presence proves the page
    // rendered past its skeleton.
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();

    // Static summary-card labels asserted by the E2E.
    expect(screen.getByText('Total Requests')).toBeInTheDocument();
    expect(screen.getByText('Active Users')).toBeInTheDocument();
  });

  it('passes axe audit in its loaded state', async () => {
    const { container } = render(<UsageMetricsPage organizationId="org-1" />);
    await checkAccessibility(container);
  });
});
