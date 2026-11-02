import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanup, render, screen } from '@/tests/utils/render';

import { FeedbackMetricsPage } from './feedback-metrics-page';

const query = vi.hoisted(() => vi.fn());
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: query,
}));
vi.mock('@/app/hooks/use-cached-paginated-query', () => ({
  useCachedPaginatedQuery: () => ({ results: [], status: 'Exhausted' }),
}));
// The nested DataTable reads the org id from the router; outside a
// RouterProvider that hook throws, so stub it like the other component tests.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const bucket = (provider: string, model: string) => ({
  provider,
  model,
  positive: 1,
  negative: 1,
  total: 2,
});

// One id through two providers, and a model one provider serves alone.
const stats = {
  hasAnyFeedback: true,
  message: { byRating: { positive: 3, negative: 3 }, total: 6 },
  arena: {
    byVerdict: { a_better: 0, b_better: 0, tie: 0, both_bad: 0 },
    selfMatches: 0,
    total: 0,
  },
  series: [],
  topAgents: [],
  topModels: [
    bucket('openrouter', 'deepseek-x'),
    bucket('deepinfra', 'deepseek-x'),
    bucket('openai', 'gpt-5'),
  ],
  topMatchups: [],
  capped: false,
  scanned: 6,
  windowStartMs: null,
};

function renderPage(filter: { model?: string; provider?: string } = {}) {
  query.mockReturnValue({ data: stats, isLoading: false, error: null });
  const onSelectModel = vi.fn();
  const view = render(
    <FeedbackMetricsPage
      organizationId="org-1"
      period="7"
      kind="all"
      withCommentOnly={false}
      {...filter}
      onChangePeriod={vi.fn()}
      onChangeKind={vi.fn()}
      onToggleCommentOnly={vi.fn()}
      onSelectAgent={vi.fn()}
      onSelectModel={onSelectModel}
      onClearFilters={vi.fn()}
    />,
  );
  return { ...view, onSelectModel };
}

afterEach(() => {
  cleanup();
  query.mockReset();
});

// #5270: the model filter narrows to a model as one provider serves it, so
// its chip names that provider too.
describe('FeedbackMetricsPage model filter', () => {
  it('names the provider its model filter also narrows to, and clears both', async () => {
    const { user, onSelectModel } = renderPage({
      model: 'deepseek-x',
      provider: 'deepinfra',
    });

    const chip = screen.getByText('Model: deepinfra · deepseek-x');
    expect(screen.queryByText(/^Provider:/)).not.toBeInTheDocument();

    await user.click(chip);

    expect(onSelectModel).toHaveBeenCalledWith(null, null);
  });

  it('names the provider of a model one provider serves', () => {
    renderPage({ model: 'gpt-5', provider: 'openai' });

    expect(screen.getByText('Model: openai · gpt-5')).toBeInTheDocument();
  });

  it('names a model filter that carries no provider by its model alone', () => {
    renderPage({ model: 'gpt-5' });

    expect(screen.getByText('Model: gpt-5')).toBeInTheDocument();
  });

  it('names an id two providers serve with each in Top models, and narrows to the pair', async () => {
    const { user, onSelectModel } = renderPage();

    expect(
      screen.getByRole('button', { name: 'Filter by openrouter · deepseek-x' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Filter by gpt-5' }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Filter by deepinfra · deepseek-x' }),
    );

    expect(onSelectModel).toHaveBeenCalledWith('deepseek-x', 'deepinfra');
  });
});
