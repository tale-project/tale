import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { UsageMetricsPage } from './usage-metrics-page';

const { useBackendQuery } = vi.hoisted(() => ({ useBackendQuery: vi.fn() }));
vi.mock('@/app/hooks/use-backend-query', () => ({ useBackendQuery }));

// The nested DataTable reads the org id from the router; outside a
// RouterProvider that hook throws, so stub it like the other component tests.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const model = (provider: string, id: string) => ({
  provider,
  model: id,
  requests: 2,
  tokens: 200,
  costCents: 20,
});

// One id through two providers, and a model one provider serves alone.
useBackendQuery.mockReturnValue({
  data: {
    summary: {
      totalRequests: 8,
      totalTokens: 800,
      totalCostCents: 80,
      activeUsers: 1,
      capped: false,
    },
    series: [],
    topAgents: [],
    topModels: [
      model('openrouter', 'deepseek-x'),
      model('deepinfra', 'deepseek-x'),
      model('openai', 'gpt-5'),
    ],
    topVoiceModels: [
      {
        provider: 'elevenlabs',
        model: 'eleven-v3',
        requests: 1,
        characters: 120,
        costCents: 3,
      },
    ],
    users: [],
  },
  isLoading: false,
});

/** The model and provider the page's latest read asked for. */
function lastFilter() {
  const args: unknown = useBackendQuery.mock.calls.at(-1)?.[1];
  expect(args).toBeTypeOf('object');
  const { model: id, provider } = args as {
    model?: string;
    provider?: string;
  };
  return { model: id, provider };
}

// #5270: the same model id can come from two providers, so a Top models row
// narrows to its model as its provider serves it, and names its provider
// where another row holds the id too.
describe('UsageMetricsPage model filter', () => {
  it('names an id two providers serve with each, and a model one provider serves alone', () => {
    render(<UsageMetricsPage organizationId="org-1" />);

    expect(
      screen.getByRole('button', { name: 'Filter by openrouter · deepseek-x' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Filter by deepinfra · deepseek-x' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Filter by gpt-5' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Filter by deepseek-x' }),
    ).not.toBeInTheDocument();
  });

  it('narrows to one provider of an id two providers serve, names both in one chip, and clears both', async () => {
    const { user } = render(<UsageMetricsPage organizationId="org-1" />);
    expect(lastFilter()).toEqual({ model: undefined, provider: undefined });

    await user.click(
      screen.getByRole('button', { name: 'Filter by deepinfra · deepseek-x' }),
    );

    expect(lastFilter()).toEqual({
      model: 'deepseek-x',
      provider: 'deepinfra',
    });
    const chip = screen.getByText('Model: deepinfra · deepseek-x');
    expect(screen.queryByText(/^Provider:/)).not.toBeInTheDocument();

    await user.click(chip);

    expect(lastFilter()).toEqual({ model: undefined, provider: undefined });
    expect(screen.queryByText(/^Model:/)).not.toBeInTheDocument();
  });

  it('carries the provider of a model one provider serves, and its chip names it', async () => {
    const { user } = render(<UsageMetricsPage organizationId="org-1" />);

    await user.click(screen.getByRole('button', { name: 'Filter by gpt-5' }));

    expect(lastFilter()).toEqual({ model: 'gpt-5', provider: 'openai' });
    expect(screen.getByText('Model: openai · gpt-5')).toBeInTheDocument();
  });

  it('narrows a pointer click on the row the same way', async () => {
    const { user } = render(<UsageMetricsPage organizationId="org-1" />);

    // The row's own click (a pointer convenience) applies the same filter.
    const row = screen
      .getByRole('button', { name: 'Filter by openrouter · deepseek-x' })
      .closest('tr');
    expect(row).not.toBeNull();
    const badge = row?.querySelector('td:last-child');
    expect(badge).toBeTruthy();
    if (badge) await user.click(badge);

    expect(lastFilter()).toEqual({
      model: 'deepseek-x',
      provider: 'openrouter',
    });
  });

  it('narrows a voice model to its provider too', async () => {
    const { user } = render(<UsageMetricsPage organizationId="org-1" />);

    await user.click(
      screen.getByRole('button', { name: 'Filter by eleven-v3' }),
    );

    expect(lastFilter()).toEqual({
      model: 'eleven-v3',
      provider: 'elevenlabs',
    });
    expect(
      screen.getByText('Model: elevenlabs · eleven-v3'),
    ).toBeInTheDocument();
  });
});
