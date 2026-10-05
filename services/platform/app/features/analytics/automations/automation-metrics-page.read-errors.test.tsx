import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReturnsOf } from '@/app/lib/backend/contract';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { AutomationMetricsPage } from './automation-metrics-page';

const { query, refetch } = vi.hoisted(() => ({
  query: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/app/hooks/use-backend-query', () => ({ useBackendQuery: query }));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

type Metrics = ReturnsOf<'automations/queries:getOrgAutomationMetrics'>;

const emptyMetrics: Metrics = {
  summary: {
    total: 0,
    success: 0,
    failed: 0,
    running: 0,
    waiting: 0,
    queued: 0,
    cancelled: 0,
    successRate: 0,
    avgDurationSeconds: 0,
    lastRun: null,
    capped: false,
  },
  previousSummary: {
    total: 0,
    success: 0,
    failed: 0,
    successRate: 0,
    avgDurationSeconds: 0,
  },
  series: [],
  topAutomations: [],
};

const populatedMetrics: Metrics = {
  ...emptyMetrics,
  summary: {
    ...emptyMetrics.summary,
    total: 42,
    success: 42,
    successRate: 100,
  },
  topAutomations: [
    {
      name: 'billing/reminder',
      total: 42,
      success: 42,
      failed: 0,
      successRate: 100,
      avgDurationSeconds: 90,
      lastRun: 1,
    },
  ],
};

const failedRead = {
  data: undefined,
  isLoading: false,
  isError: true,
  isFetching: false,
  errorUpdateCount: 1,
  error: new Error('503 Service unavailable'),
  refetch,
};

function page(periodDays: 7 | 30 | 90 = 30) {
  return (
    <AutomationMetricsPage
      organizationId="org-1"
      periodDays={periodDays}
      onChangePeriod={vi.fn()}
      onSelectAutomation={vi.fn()}
    />
  );
}

describe('AutomationMetricsPage read failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.mockReturnValue(failedRead);
  });

  it('names a failed first read without zero metrics or empty-run teaching', () => {
    render(page());
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load automation metrics.",
    );
    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('No automation runs')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it.each([7, 30, 90] as const)(
    'retries the same organization and %s-day query',
    async (periodDays) => {
      const { user } = render(page(periodDays));
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenLastCalledWith(
        'automations/queries:getOrgAutomationMetrics',
        { organizationId: 'org-1', periodDays },
        { enabled: true },
      );
    },
  );

  it('keeps the failure and focused retry stable while retrying and failing again', async () => {
    const { user, rerender } = render(page());
    const retry = screen.getByRole('button', { name: 'Try again' });
    await user.click(retry);
    query.mockReturnValue({
      ...failedRead,
      isLoading: true,
      isError: false,
      isFetching: true,
      error: null,
    });
    rerender(page());
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    await user.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('No automation runs')).not.toBeInTheDocument();
    query.mockReturnValue({ ...failedRead, errorUpdateCount: 2 });
    rerender(page());
    expect(screen.getByRole('button', { name: 'Try again' })).toBe(retry);
    expect(retry).toHaveFocus();
    expect(retry).not.toHaveAttribute('aria-busy');
  });

  it('hands retry focus to the recovered metrics region', async () => {
    const { user, rerender } = render(page());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    query.mockReturnValue({
      ...failedRead,
      data: populatedMetrics,
      isError: false,
      error: null,
    });
    rerender(page());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Automation metrics' }),
      ).toHaveFocus(),
    );
    expect(screen.getByText('billing/reminder')).toBeInTheDocument();
  });

  it('retains cached figures and rows while naming a failed refresh', () => {
    query.mockReturnValue({ ...failedRead, data: populatedMetrics });
    render(page());
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't refresh automation metrics. The figures shown may be out of date.",
    );
    expect(screen.getAllByText('42').length).toBeGreaterThan(0);
    expect(screen.getByText('billing/reminder')).toBeInTheDocument();
    expect(screen.queryByText('No automation runs')).not.toBeInTheDocument();
  });

  it('shows zero metrics and empty-run teaching after a successful empty response', () => {
    query.mockReturnValue({
      ...failedRead,
      data: emptyMetrics,
      isError: false,
      error: null,
      errorUpdateCount: 0,
    });
    render(page());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('No automation runs')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('does not announce a failure during initial loading', () => {
    query.mockReturnValue({
      ...failedRead,
      isLoading: true,
      isError: false,
      isFetching: true,
      error: null,
      errorUpdateCount: 0,
    });
    render(page());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('No automation runs')).not.toBeInTheDocument();
  });

  it('passes an accessibility audit for an unavailable read', async () => {
    const { container } = render(page());
    await checkAccessibility(container);
  });
});
