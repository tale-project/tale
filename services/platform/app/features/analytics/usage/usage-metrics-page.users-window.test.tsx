import { DEFAULT_LIST_PAGE_SIZE } from '@tale/ui/list-page-size';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { act, render, screen } from '@/tests/utils/render';

import { UsageMetricsPage } from './usage-metrics-page';

const { useBackendQuery } = vi.hoisted(() => ({ useBackendQuery: vi.fn() }));
vi.mock('@/app/hooks/use-backend-query', () => ({ useBackendQuery }));

// The nested DataTable reads the org id from the router; outside a
// RouterProvider that hook throws, so stub it like the other component tests.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

/** More users than one display window holds. */
const MANY = DEFAULT_LIST_PAGE_SIZE + 5;

/** The sentinels the tables watch, so a test can scroll one into view. */
const watched: { callback: IntersectionObserverCallback; target: Element }[] =
  [];

class RecordingObserver {
  readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    watched.push({ callback: this.callback, target });
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function scrollToEnd() {
  const sentinel = watched.at(-1);
  expect(sentinel).toBeDefined();
  act(() => {
    sentinel?.callback(
      [
        {
          isIntersecting: true,
          target: sentinel.target,
        } as unknown as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
  });
}

function shownUsers() {
  return screen.getAllByText(/^Person \d+$/);
}

afterEach(() => {
  watched.length = 0;
  vi.unstubAllGlobals();
});

// The users table shows a window of the period's users that grows as the
// reader scrolls (#5163). The page names the read the rows answer, so another
// period or drill-down starts that window over, while the chart's own
// controls keep it.
describe('UsageMetricsPage users window', () => {
  it('starts over for another period or drill-down, and holds through the chart controls', async () => {
    vi.stubGlobal('IntersectionObserver', RecordingObserver);
    useBackendQuery.mockReturnValue({
      data: {
        summary: {
          totalRequests: MANY,
          totalTokens: 15 * MANY,
          totalCostCents: 10 * MANY,
          activeUsers: MANY,
          capped: false,
        },
        series: [],
        topAgents: [
          {
            agentSlug: 'agent-1',
            displayName: 'Alice the agent',
            requests: MANY,
            tokens: 15 * MANY,
            costCents: 10 * MANY,
          },
        ],
        topModels: [],
        topVoiceModels: [],
        users: Array.from({ length: MANY }, (_, i) => ({
          userId: `user-${i}`,
          displayName: `Person ${i}`,
          teamId: null,
          inputTokens: 10,
          outputTokens: 5,
          tokens: 15,
          costCents: 10,
          requests: 1,
        })),
      },
      isLoading: false,
    });
    const controlled = {
      organizationId: 'org-1',
      onChangePeriod: vi.fn(),
      onChangeGranularity: vi.fn(),
      onChangeMetric: vi.fn(),
    };
    const { rerender, user } = render(
      <UsageMetricsPage
        {...controlled}
        periodDays={30}
        granularity="daily"
        metric="tokens"
      />,
    );

    expect(shownUsers()).toHaveLength(DEFAULT_LIST_PAGE_SIZE);
    scrollToEnd();
    expect(shownUsers()).toHaveLength(MANY);

    // Granularity and metric reshape only the chart.
    rerender(
      <UsageMetricsPage
        {...controlled}
        periodDays={30}
        granularity="weekly"
        metric="cost"
      />,
    );
    expect(shownUsers()).toHaveLength(MANY);

    rerender(
      <UsageMetricsPage
        {...controlled}
        periodDays={7}
        granularity="weekly"
        metric="cost"
      />,
    );
    expect(shownUsers()).toHaveLength(DEFAULT_LIST_PAGE_SIZE);

    scrollToEnd();
    expect(shownUsers()).toHaveLength(MANY);
    await user.click(
      screen.getByRole('button', { name: 'Filter by Alice the agent' }),
    );
    expect(shownUsers()).toHaveLength(DEFAULT_LIST_PAGE_SIZE);
  });
});
