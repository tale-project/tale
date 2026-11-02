import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ChatHealthMetricsPage } from './chat-health-metrics-page';

// One id through two providers, a model one provider serves alone, and a
// model whose turns stored no provider.
const fixtures = vi.hoisted(() => ({
  health: {
    summary: {
      totalTurns: 20,
      errorCount: 3,
      errorRate: 0.15,
      blockedCount: 0,
      blockedRate: 0,
      tokens: { input: 1000, output: 400, total: 1400 },
      capped: false,
      hasAnyData: true,
    },
    series: [{ dateKey: '2026-07-23', turns: 20, errors: 3, blocked: 0 }],
    byModel: [
      { provider: 'openrouter', model: 'deepseek-x', count: 9 },
      { provider: 'deepinfra', model: 'deepseek-x', count: 5 },
      { provider: 'openai', model: 'gpt-5', count: 4 },
      { provider: '', model: 'legacy-model', count: 2 },
    ],
    byAgent: [{ agentSlug: 'helper', count: 20 }],
    errorsByType: [{ key: 'rate_limited', count: 3 }],
    recentErrors: [
      {
        at: Date.now(),
        type: 'rate_limited',
        model: 'deepseek-x',
        provider: 'deepinfra',
        agentSlug: 'helper',
      },
      {
        at: Date.now(),
        type: 'rate_limited',
        model: 'gpt-5',
        provider: 'openai',
      },
      { at: Date.now(), type: 'rate_limited', model: 'legacy-model' },
    ],
  },
  guardrails: {
    byKind: [],
    byFilter: [],
    byDirection: [],
    byCategory: [],
    series: [],
    capped: false,
  },
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string) => ({
    data: name.includes('getGuardrailStats')
      ? fixtures.guardrails
      : fixtures.health,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

// #5270: two providers can serve one model id, so the page names a model's
// provider in the row itself wherever another provider serves the id too,
// and spells out the provider in the hover title wherever the row knows it.
describe('ChatHealthMetricsPage model names', () => {
  it('names an id two providers serve with each, in the breakdown and the recent errors', () => {
    render(
      <ChatHealthMetricsPage
        organizationId="org-1"
        period="7"
        onChangePeriod={() => undefined}
      />,
    );

    expect(screen.getByText('openrouter · deepseek-x')).toBeInTheDocument();
    // In the breakdown, and on the recent error it served.
    expect(screen.getAllByText('deepinfra · deepseek-x')).toHaveLength(2);
    expect(screen.queryByText('deepseek-x')).not.toBeInTheDocument();
  });

  it('names a model one provider serves alone, with its provider in the hover title', () => {
    render(
      <ChatHealthMetricsPage
        organizationId="org-1"
        period="7"
        onChangePeriod={() => undefined}
      />,
    );

    // The breakdown row and the recent error.
    expect(screen.getAllByText('gpt-5')).toHaveLength(2);
    expect(screen.getAllByTitle('openai · gpt-5')).toHaveLength(2);
    expect(screen.queryByText('openai · gpt-5')).not.toBeInTheDocument();
  });

  it('names a model whose turns stored no provider by its model alone', () => {
    render(
      <ChatHealthMetricsPage
        organizationId="org-1"
        period="7"
        onChangePeriod={() => undefined}
      />,
    );

    expect(screen.getAllByText('legacy-model')).toHaveLength(2);
    expect(screen.getAllByTitle('legacy-model')).toHaveLength(2);
  });
});
