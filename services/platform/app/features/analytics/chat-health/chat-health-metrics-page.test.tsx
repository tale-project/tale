import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ChatHealthMetricsPage } from './chat-health-metrics-page';

// Pure, prop-driven render assertion (mirrors the usage metrics page test).
// The page owns TWO queries (chat health + guardrail stats), so the mock
// branches on the called function's name to serve each its fixture.
const fixtures = vi.hoisted(() => ({
  health: {
    summary: {
      totalTurns: 25,
      errorCount: 2,
      errorRate: 0.08,
      blockedCount: 1,
      blockedRate: 0.04,
      tokens: { input: 1000, output: 400, total: 1400 },
      capped: false,
      hasAnyData: true,
    },
    series: [{ dateKey: '2026-07-23', turns: 25, errors: 2, blocked: 1 }],
    byModel: [{ provider: 'openai', model: 'gpt-4o', count: 20 }],
    byAgent: [
      { agentSlug: 'helper', count: 15 },
      { agentSlug: '__unattributed__', count: 10 },
    ],
    errorsByType: [{ key: 'rate_limited', count: 2 }],
    recentErrors: [
      {
        at: Date.now(),
        type: 'rate_limited',
        model: 'gpt-4o',
        agentSlug: 'helper',
      },
    ],
  },
  guardrails: {
    byKind: [
      { key: 'detected', count: 6 },
      { key: 'blocked', count: 2 },
    ],
    byFilter: [{ key: 'pii', count: 8 }],
    byDirection: [{ key: 'input', count: 8 }],
    byCategory: [{ key: 'email', count: 5 }],
    series: [{ dateKey: '2026-07-23', detected: 6, blocked: 2, errors: 0 }],
    capped: false,
  },
}));

vi.mock('@/app/hooks/use-backend-query', async () => {
  const { getFunctionName } = await import('convex/server');
  return {
    useBackendQuery: (fn: never) => ({
      data: getFunctionName(fn).includes('getGuardrailStats')
        ? fixtures.guardrails
        : fixtures.health,
      isLoading: false,
    }),
  };
});

describe('ChatHealthMetricsPage', () => {
  it('renders the title, period control, cards, breakdowns, and guardrail stats', () => {
    render(
      <ChatHealthMetricsPage
        organizationId="org-1"
        period="7"
        onChangePeriod={() => undefined}
      />,
    );

    // Page title + period control (its presence proves the page rendered past
    // its skeleton and its empty/error branches).
    expect(
      screen.getByRole('heading', { name: 'Chat health' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();

    // Summary card labels/values from surviving i18n keys.
    expect(screen.getByText('Assistant turns')).toBeInTheDocument();
    expect(screen.getByText('Error rate')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('8%')).toBeInTheDocument();

    // Model/agent breakdown rows (both also appear in the recent-errors list).
    expect(screen.getAllByText('gpt-4o').length).toBeGreaterThan(0);
    expect(screen.getAllByText('helper').length).toBeGreaterThan(0);
    expect(screen.getByText('Unattributed')).toBeInTheDocument();

    // Errors section: classified type label + the recent-errors list.
    expect(screen.getAllByText('Rate limited').length).toBeGreaterThan(0);
    expect(screen.getByText('Recent errors')).toBeInTheDocument();

    // Guardrails section: kind/filter labels reuse the guardrails-overview
    // vocabulary from the governance namespace ('Detected' also appears in
    // the guardrail chart legend).
    expect(screen.getAllByText('Detected').length).toBeGreaterThan(0);
    expect(screen.getByText('PII')).toBeInTheDocument();
  });

  it('passes axe audit in its loaded state', async () => {
    const { container } = render(
      <ChatHealthMetricsPage
        organizationId="org-1"
        period="7"
        onChangePeriod={() => undefined}
      />,
    );
    await checkAccessibility(container);
  });
});
