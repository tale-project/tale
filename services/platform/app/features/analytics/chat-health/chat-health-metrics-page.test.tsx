import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ChatHealthMetricsPage } from './chat-health-metrics-page';
import type { ChatHealthPeriod } from './chat-health-period';

// The page reads one Convex query and lays out KPI cards + routing breakdowns —
// a render seam (no persistence, navigation, or RBAC in the assertion), so it
// lives at the component tier with the query hook mocked (mirrors
// feedback-page.test.tsx). `result` is mutable so each test drives a branch.
type HookResult = { data: unknown; isLoading: boolean; error: Error | null };
let result: HookResult = { data: null, isLoading: false, error: null };

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => result,
}));

function rollup(overrides: Record<string, unknown> = {}) {
  return {
    totalMessages: 10,
    errorCount: 1,
    errorRate: 0.1,
    blockedCount: 0,
    blockedRate: 0,
    latency: {
      durationMs: { p50: 200, p95: 1200, count: 10 },
      timeToFirstTokenMs: { p50: 80, p95: 300, count: 10 },
    },
    tools: {
      totalCalls: 3,
      messagesUsingTools: 2,
      byTool: [{ key: 'web_search', count: 3 }],
    },
    routing: {
      byAutoRouteReason: [
        { key: 'classified', count: 6 },
        { key: 'pinned', count: 4 },
      ],
      byAgentSlug: [{ key: 'researcher', count: 6 }],
      byModel: [{ provider: 'openai', model: 'gpt-4o', count: 10 }],
    },
    tokens: { input: 100, output: 50, total: 150 },
    costCents: 12,
    capped: false,
    scanned: 10,
    windowStartMs: 0,
    hasAnyData: true,
    ...overrides,
  };
}

function renderPage(period: ChatHealthPeriod = '7') {
  return render(
    <ChatHealthMetricsPage
      organizationId="org_1"
      period={period}
      onChangePeriod={vi.fn()}
    />,
  );
}

describe('ChatHealthMetricsPage', () => {
  it('renders the health panel with KPIs and routing when loaded', () => {
    result = { data: rollup(), isLoading: false, error: null };
    renderPage();

    expect(
      screen.getByRole('heading', { name: /chat health/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Error rate')).toBeInTheDocument();
    expect(screen.getByText('Routing')).toBeInTheDocument();
    // Routing dimensions + a resolved model label.
    expect(screen.getByText('By agent')).toBeInTheDocument();
    expect(screen.getByText('openai / gpt-4o')).toBeInTheDocument();
    // The `pinned` sentinel resolves to a friendly label, not the raw key.
    expect(screen.getByText('Pinned')).toBeInTheDocument();
  });

  it('shows the teaching panel when the org has no telemetry', () => {
    result = {
      data: rollup({ hasAnyData: false, totalMessages: 0 }),
      isLoading: false,
      error: null,
    };
    renderPage();

    expect(screen.getByText(/no chat activity yet/i)).toBeInTheDocument();
    // KPI cards are replaced by the teaching panel.
    expect(screen.queryByText('Error rate')).not.toBeInTheDocument();
  });

  it('shows an error alert when the query fails', () => {
    result = { data: null, isLoading: false, error: new Error('boom') };
    renderPage();

    expect(
      screen.getByText(/couldn't load chat health metrics/i),
    ).toBeInTheDocument();
  });
});
